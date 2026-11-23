import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Lock,
  Upload,
  FileSpreadsheet,
  FileText,
  AlertTriangle,
  Accessibility,
  Users,
  CheckCircle2,
  Search,
  ChevronRight,
  X,
  Trash2,
  Download,
  RefreshCw,
  BookOpen,
  CalendarClock,
  Eye,
  Save,
  Layers,
  ShieldAlert,
  ExternalLink,
  Check,
  Award,
  ScrollText,
  Sparkles,
  History
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { getAuthHeaders } from '../lib/auth';
import { db, collection, getDocs } from '../lib/database';
import {
  AlunoConselhoClassificado,
  AtaConselhoTurmaData,
  BimestreConselhoKey,
  ConselhoTurmaDoc,
  DELIBERACAO_LABELS,
  DeliberacaoAlunoConselho,
  MapaoConselhoParsed,
  PRIORIDADE_LABELS,
  RESULTADO_FINAL_LABELS,
  ResultadoFinalConselho,
  StatusDeliberacaoConselho,
  classificarAlunosConselho,
  construirConselhoTurmasDeBoletinsAlunos,
  gerarChaveTurmaBimestre,
  ordenarTurmasEscolar,
  parseMapaoConselhoExcelRows,
  resumirEstatisticasTurma,
  sugerirTurmasAnoSeguinte
} from '../modules/mapaoConselhoParser';
import { exportarPautaConselhoTurmaPDF } from '../utils/conselhoEspecialPdfExport';
import ConselhoAtaEditor from './ConselhoAtaEditor';
import { obterAnoLetivoVigente, sincronizarAnoLetivoComServidor } from '../modules/anoLetivoHelper';

type FiltroConselho =
  | 'PAUTA'
  | 'REPROVANDO_FALTAS'
  | 'NOTAS_4_MAIS'
  | 'AEE'
  | 'ATIVOS'
  | 'TRANSFERIDOS';

type SubAbaTurma = 'TRIAGEM' | 'RESULTADO_FINAL' | 'ATA';

type OrdenacaoConselho = 'criticidade' | 'freq_asc' | 'vermelhas_desc' | 'chamada' | 'nome';

const BIMESTRES_OPCOES: Array<{ key: BimestreConselhoKey; label: string }> = [
  { key: '1B', label: '1º Bim' },
  { key: '2B', label: '2º Bim' },
  { key: '3B', label: '3º Bim' },
  { key: '4B', label: '4º Bim' },
  { key: 'FINAL', label: 'Final' }
];

const MODELO_MAPAO_URL =
  '/assets/aistudio/MAPAO_CLOVIS_DE_LUCCA_PROFESSOR_6__ANO_A_INTEGRAL_7H_T1_ANUAL_CONSELHO_TERCEIRO_BIMESTRE_22112026_1928_edbc302c.pdf';

function fileToBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const str = String(reader.result || '');
      const idx = str.indexOf(',');
      resolve(idx !== -1 ? str.slice(idx + 1) : str);
    };
    reader.onerror = () => reject(new Error('Falha ao ler arquivo no navegador.'));
    reader.readAsDataURL(file);
  });
}

function showFeedback(msg: string, type: 'success' | 'warning' | 'error' | 'info' = 'info') {
  if (typeof window !== 'undefined' && typeof (window as any).showToast === 'function') {
    (window as any).showToast(msg, type, 4000);
  }
}

export default function ConselhoBimestreEspecial() {
  const [anoLetivo, setAnoLetivo] = useState<number>(() => obterAnoLetivoVigente());
  const [anoVigenteSistema, setAnoVigenteSistema] = useState<number>(() => obterAnoLetivoVigente());
  const [bimestreAtivo, setBimestreAtivo] = useState<BimestreConselhoKey>('3B');
  const [turmasDocs, setTurmasDocs] = useState<ConselhoTurmaDoc[]>([]);
  const [baseAlunos, setBaseAlunos] = useState<any[]>(() => {
    if (typeof window !== 'undefined' && Array.isArray((window as any).allStudentsData)) {
      return (window as any).allStudentsData;
    }
    return [];
  });

  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [processandoUpload, setProcessandoUpload] = useState(false);
  const [progressoUpload, setProgressoUpload] = useState('');
  const [mostrarPainelUpload, setMostrarPainelUpload] = useState(false);
  const [dragAtivo, setDragAtivo] = useState(false);

  const [modoVisao, setModoVisao] = useState<'TURMA' | 'PANORAMA'>('TURMA');
  const [subAbaTurma, setSubAbaTurma] = useState<SubAbaTurma>('TRIAGEM');
  const [chaveTurmaSelecionada, setChaveTurmaSelecionada] = useState<string>('');

  const [filtroAtivo, setFiltroAtivo] = useState<FiltroConselho>('PAUTA');
  const [buscaAluno, setBuscaAluno] = useState('');
  const [ordenacao, setOrdenacao] = useState<OrdenacaoConselho>('criticidade');
  const [filtroDisciplinaVermelha, setFiltroDisciplinaVermelha] = useState<string>('TODAS');

  const [alunoDetalheChave, setAlunoDetalheChave] = useState<string | null>(null);
  const [parecerDraft, setParecerDraft] = useState('');
  const [statusDraft, setStatusDraft] = useState<StatusDeliberacaoConselho>('PENDENTE');
  const [resultadoFinalDraft, setResultadoFinalDraft] = useState<ResultadoFinalConselho>('PENDENTE');
  const [turmaSeguinteDraft, setTurmaSeguinteDraft] = useState('');
  const [salvandoDeliberacao, setSalvandoDeliberacao] = useState(false);
  const [salvandoLote, setSalvandoLote] = useState(false);

  const [obsTurmaDraft, setObsTurmaDraft] = useState('');
  const [salvandoObsTurma, setSalvandoObsTurma] = useState(false);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState<string | null>(null);
  const [outraTurmaAluno, setOutraTurmaAluno] = useState<Record<string, boolean>>({});
  const [customTurmasDraft, setCustomTurmasDraft] = useState<Record<string, string>>({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    sincronizarAnoLetivoComServidor().then(anoSrv => {
      setAnoVigenteSistema(anoSrv);
      setAnoLetivo(anoSrv);
    });
    const onAnoChanged = (e: any) => {
      const novo = Number(e?.detail) || obterAnoLetivoVigente();
      if (Number.isFinite(novo) && novo >= 2024) {
        setAnoVigenteSistema(novo);
        setAnoLetivo(novo);
      }
    };
    window.addEventListener('clovis_ano_letivo_changed', onAnoChanged);
    return () => window.removeEventListener('clovis_ano_letivo_changed', onAnoChanged);
  }, []);

  // Carrega a base de alunos (para cruzar AEE, RA, Tutor, Recomposição e sintetizar boletins 1º-3º bim)
  const carregarBaseAlunos = useCallback(async (forceRefresh = false) => {
    if (
      !forceRefresh &&
      typeof window !== 'undefined' &&
      Array.isArray((window as any).allStudentsData) &&
      (window as any).allStudentsData.length > 0
    ) {
      setBaseAlunos((window as any).allStudentsData);
      return;
    }
    try {
      const snap = await getDocs(collection(db, 'alunos'));
      const lista: any[] = [];
      snap.forEach(d => lista.push({ id: d.id, ...d.data() }));
      setBaseAlunos(lista);
      if (typeof window !== 'undefined' && lista.length > 0) {
        (window as any).allStudentsData = lista;
      }
    } catch (e) {
      console.warn('[ConselhoEspecial] Aviso ao carregar base de alunos:', e);
    }
  }, []);

  // Carrega as turmas salvas do Conselho Especial (com autenticação estrita no servidor)
  const carregarTurmasConselho = useCallback(async () => {
    setCarregando(true);
    setErroCarga(null);
    try {
      const res = await fetch(`/api/conselho-especial/turmas?anoLetivo=${anoLetivo}`, {
        method: 'GET',
        headers: getAuthHeaders()
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Erro HTTP ${res.status} ao carregar dados do Conselho.`);
      }
      const data = await res.json();
      const lista: ConselhoTurmaDoc[] = Array.isArray(data.turmas) ? data.turmas : [];
      setTurmasDocs(lista);

      if (lista.length > 0) {
        const temNoAtual = lista.some(t => t.metadata?.bimestreKey === bimestreAtivo);
        if (!temNoAtual) {
          const bimestresDisponiveis = Array.from(new Set(lista.map(t => t.metadata?.bimestreKey).filter(Boolean))) as BimestreConselhoKey[];
          const ordemPref: BimestreConselhoKey[] = ['FINAL', '4B', '3B', '2B', '1B'];
          const escolhido = ordemPref.find(k => bimestresDisponiveis.includes(k));
          if (escolhido) setBimestreAtivo(escolhido);
        }
      }
    } catch (err: any) {
      setErroCarga(err?.message || 'Não foi possível carregar o módulo especial.');
    } finally {
      setCarregando(false);
    }
  }, [anoLetivo]);

  useEffect(() => {
    carregarBaseAlunos();
    carregarTurmasConselho();
  }, [carregarBaseAlunos, carregarTurmasConselho]);

  // Combina documentos persistidos no Conselho com os boletins (1º-3º bim) já importados no cadastro dos alunos
  const turmasCombinadas = useMemo(() => {
    const sintetizados = construirConselhoTurmasDeBoletinsAlunos(baseAlunos, anoLetivo, turmasDocs);
    return [...turmasDocs, ...sintetizados];
  }, [turmasDocs, baseAlunos, anoLetivo]);

  // Turmas filtradas pelo bimestre selecionado e ordenadas naturalmente (6ºA -> 9ºC -> 1ªA -> 3ªC)
  const turmasDoBimestre = useMemo(() => {
    const filtradas = turmasCombinadas.filter(t => t.metadata?.bimestreKey === bimestreAtivo);
    const ordemNomes = ordenarTurmasEscolar(filtradas.map(t => t.metadata.turmaNormalizada));
    const idxMap = new Map(ordemNomes.map((n, i) => [n, i]));
    return [...filtradas].sort(
      (a, b) => (idxMap.get(a.metadata.turmaNormalizada) ?? 999) - (idxMap.get(b.metadata.turmaNormalizada) ?? 999)
    );
  }, [turmasCombinadas, bimestreAtivo]);

  // Último bimestre disponível na escola (para iniciar Conselho Final com 1 clique caso Final esteja vazio)
  const turmasBaseUltimoBimestre = useMemo(() => {
    const ordem: BimestreConselhoKey[] = ['4B', '3B', '2B', '1B'];
    for (const k of ordem) {
      const lista = turmasCombinadas.filter(t => t.metadata?.bimestreKey === k);
      if (lista.length > 0) return { bimKey: k, turmas: lista };
    }
    return { bimKey: null as BimestreConselhoKey | null, turmas: [] as ConselhoTurmaDoc[] };
  }, [turmasCombinadas]);

  // Contagem de turmas por bimestre para indicar no seletor de bimestre
  const contagemPorBimestre = useMemo(() => {
    const map: Record<string, number> = {};
    turmasCombinadas.forEach(t => {
      const k = t.metadata?.bimestreKey;
      if (k) map[k] = (map[k] || 0) + 1;
    });
    return map;
  }, [turmasCombinadas]);

  // Garante que uma turma válida esteja selecionada quando houver turmas no bimestre
  useEffect(() => {
    if (turmasDoBimestre.length === 0) {
      setChaveTurmaSelecionada('');
      return;
    }
    const existe = turmasDoBimestre.some(t => t.chaveTurmaBimestre === chaveTurmaSelecionada);
    if (!existe) {
      setChaveTurmaSelecionada(turmasDoBimestre[0].chaveTurmaBimestre);
    }
  }, [turmasDoBimestre, chaveTurmaSelecionada]);

  // Ao trocar para Conselho Final, abrir diretamente a sub-aba adequada se usuário preferir, ou manter estado
  useEffect(() => {
    if (bimestreAtivo === 'FINAL') {
      setSubAbaTurma(prev => (prev === 'ATA' ? 'ATA' : 'RESULTADO_FINAL'));
    } else if (subAbaTurma === 'RESULTADO_FINAL') {
      setSubAbaTurma('TRIAGEM');
    }
  }, [bimestreAtivo]);

  // Classificação completa de todas as turmas do bimestre (para rail de turmas + Panorama Geral)
  const turmasClassificadas = useMemo(() => {
    return turmasDoBimestre.map(doc => {
      const alunos = classificarAlunosConselho(doc.alunosRaw || [], doc.metadata, baseAlunos, doc.deliberacoes || {});
      const stats = resumirEstatisticasTurma(alunos);
      return { doc, alunos, stats };
    });
  }, [turmasDoBimestre, baseAlunos]);

  const turmaAtualObj = useMemo(() => {
    return turmasClassificadas.find(t => t.doc.chaveTurmaBimestre === chaveTurmaSelecionada) || turmasClassificadas[0] || null;
  }, [turmasClassificadas, chaveTurmaSelecionada]);

  // Sincroniza rascunho de observações gerais da turma ao trocar de turma
  useEffect(() => {
    setObsTurmaDraft(turmaAtualObj?.doc.observacoesGeraisTurma || '');
    setFiltroDisciplinaVermelha('TODAS');
    setAlunoDetalheChave(null);
  }, [turmaAtualObj?.doc.chaveTurmaBimestre]);

  // Sincroniza rascunho de deliberação ao abrir o detalhe de um aluno
  const alunoDetalhe = useMemo(() => {
    if (!alunoDetalheChave || !turmaAtualObj) return null;
    return turmaAtualObj.alunos.find(a => a.chaveAluno === alunoDetalheChave) || null;
  }, [alunoDetalheChave, turmaAtualObj]);

  useEffect(() => {
    if (alunoDetalhe && turmaAtualObj) {
      setStatusDraft(alunoDetalhe.deliberacao.status || 'PENDENTE');
      setParecerDraft(alunoDetalhe.deliberacao.parecer || '');
      const resFin = alunoDetalhe.deliberacao.resultadoFinal || 'PENDENTE';
      setResultadoFinalDraft(resFin);
      setTurmaSeguinteDraft(
        alunoDetalhe.deliberacao.turmaAnoSeguinte ||
          sugerirTurmasAnoSeguinte(turmaAtualObj.doc.metadata.turmaNormalizada, resFin).sugestaoPrincipal
      );
    }
  }, [alunoDetalhe, turmaAtualObj]);

  // Persistir Mapões parseados no MongoDB (e sincronizar boletim escolar em 'alunos')
  const persistirMapoesParsed = useCallback(
    async (parsedList: MapaoConselhoParsed[]) => {
      const salvos: ConselhoTurmaDoc[] = [];
      let ultimoBimestre: BimestreConselhoKey | null = null;
      let ultimaChave: string | null = null;
      let totalAlunosSync = 0;

      for (let i = 0; i < parsedList.length; i++) {
        const mp = parsedList[i];
        setProgressoUpload(`Salvando ${mp.metadata.turmaNormalizada} (${i + 1}/${parsedList.length})...`);

        const res = await fetch('/api/conselho-especial/salvar-turma', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            metadata: mp.metadata,
            alunosRaw: mp.alunos,
            sincronizarBoletimAlunos: true
          })
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Falha ao salvar ${mp.metadata.turmaNormalizada}.`);
        }
        const data = await res.json();
        if (data.turma) {
          salvos.push(data.turma);
          ultimoBimestre = mp.metadata.bimestreKey;
          ultimaChave = data.turma.chaveTurmaBimestre;
          totalAlunosSync += Number(data.alunosBoletimSincronizados || 0);
        }
      }

      if (salvos.length > 0) {
        setTurmasDocs(prev => {
          const map = new Map(prev.map(item => [item.chaveTurmaBimestre, item]));
          salvos.forEach(s => map.set(s.chaveTurmaBimestre, s));
          return Array.from(map.values());
        });
        if (ultimoBimestre) setBimestreAtivo(ultimoBimestre);
        if (ultimaChave) {
          setChaveTurmaSelecionada(ultimaChave);
          setModoVisao('TURMA');
        }
        setMostrarPainelUpload(false);
        carregarBaseAlunos(true);
        const msgSync = totalAlunosSync > 0 ? ` (${totalAlunosSync} boletins atualizados no cadastro)` : '';
        showFeedback(
          salvos.length === 1
            ? `Mapão de ${salvos[0].metadata.turmaNormalizada} importado e classificado${msgSync}.`
            : `${salvos.length} mapões importados e classificados${msgSync}.`,
          'success'
        );
      }
    },
    [carregarBaseAlunos]
  );

  // Iniciar Conselho Final clonando as turmas do último bimestre salvo (3º/4º Bim) para começar imediatamente
  const iniciarConselhoFinalDeBase = useCallback(async () => {
    if (turmasBaseUltimoBimestre.turmas.length === 0) return;
    setProcessandoUpload(true);
    setProgressoUpload(`Preparando Conselho Final a partir do ${turmasBaseUltimoBimestre.bimKey}...`);
    try {
      const salvos: ConselhoTurmaDoc[] = [];
      for (let i = 0; i < turmasBaseUltimoBimestre.turmas.length; i++) {
        const src = turmasBaseUltimoBimestre.turmas[i];
        setProgressoUpload(
          `Criando rascunho Final de ${src.metadata.turmaNormalizada} (${i + 1}/${turmasBaseUltimoBimestre.turmas.length})...`
        );
        const metaFinal = {
          ...src.metadata,
          bimestre: 5,
          bimestreKey: 'FINAL' as BimestreConselhoKey,
          tipoFechamento: `Conselho Final (Base ${src.metadata.bimestreKey})`
        };
        const res = await fetch('/api/conselho-especial/salvar-turma', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            metadata: metaFinal,
            alunosRaw: src.alunosRaw,
            sincronizarBoletimAlunos: false
          })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Falha ao preparar ${src.metadata.turmaNormalizada}.`);
        }
        const data = await res.json();
        if (data.turma) salvos.push(data.turma);
      }

      if (salvos.length > 0) {
        setTurmasDocs(prev => {
          const map = new Map(prev.map(item => [item.chaveTurmaBimestre, item]));
          salvos.forEach(s => map.set(s.chaveTurmaBimestre, s));
          return Array.from(map.values());
        });
        setBimestreAtivo('FINAL');
        setChaveTurmaSelecionada(salvos[0].chaveTurmaBimestre);
        setModoVisao('TURMA');
        setSubAbaTurma('RESULTADO_FINAL');
        setMostrarPainelUpload(false);
        showFeedback(
          `Conselho Final iniciado com ${salvos.length} turmas a partir do ${turmasBaseUltimoBimestre.bimKey}. Você já pode marcar Aprovados/Reprovados, Turma ${anoLetivo + 1} e gerar a Ata em PDF.`,
          'success'
        );
      }
    } catch (err: any) {
      showFeedback(err?.message || 'Erro ao preparar Conselho Final.', 'error');
    } finally {
      setProcessandoUpload(false);
      setProgressoUpload('');
    }
  }, [turmasBaseUltimoBimestre, anoLetivo]);

  // Processar arquivos selecionados ou arrastados (PDF e/ou Excel)
  const processarArquivosMapao = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList || []);
      if (files.length === 0) return;

      setProcessandoUpload(true);
      setProgressoUpload(`Lendo ${files.length} arquivo${files.length > 1 ? 's' : ''} do Mapão...`);

      try {
        const pdfPayload: Array<{ fileName: string; fileBase64: string }> = [];
        const parsedResults: MapaoConselhoParsed[] = [];
        const errosLocais: string[] = [];

        for (const f of files) {
          const lower = f.name.toLowerCase();
          if (lower.endsWith('.pdf')) {
            const b64 = await fileToBase64(f);
            pdfPayload.push({ fileName: f.name, fileBase64: b64 });
          } else if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
            try {
              const ab = await f.arrayBuffer();
              const wb = XLSX.read(ab, { type: 'array' });
              const firstSheet = wb.Sheets[wb.SheetNames[0]];
              const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' }) as any[][];
              const parsed = parseMapaoConselhoExcelRows(rows, f.name);
              if (parsed.sucesso) {
                parsedResults.push(parsed);
              } else {
                errosLocais.push(`${f.name}: ${parsed.mensagem || 'formato não reconhecido.'}`);
              }
            } catch (xlErr: any) {
              errosLocais.push(`${f.name}: ${xlErr?.message || 'falha ao ler Excel.'}`);
            }
          } else {
            errosLocais.push(`${f.name}: formato não suportado. Envie PDF ou Excel (.xlsx) do Mapão SED.`);
          }
        }

        if (pdfPayload.length > 0) {
          setProgressoUpload(`Extraindo notas, faltas e reposições (AC) de ${pdfPayload.length} PDF(s)...`);
          const res = await fetch('/api/conselho-especial/parse-mapao', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ files: pdfPayload })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(data.error || `Erro HTTP ${res.status} ao extrair PDF.`);
          }
          if (Array.isArray(data.mapoes)) {
            parsedResults.push(...data.mapoes);
          }
          if (Array.isArray(data.erros) && data.erros.length > 0) {
            errosLocais.push(...data.erros);
          }
        }

        if (parsedResults.length === 0) {
          throw new Error(errosLocais[0] || 'Nenhum Mapão válido encontrado nos arquivos enviados.');
        }

        await persistirMapoesParsed(parsedResults);

        if (errosLocais.length > 0) {
          showFeedback(`Importação parcial: ${errosLocais[0]}`, 'warning');
        }
      } catch (err: any) {
        showFeedback(err?.message || 'Erro ao processar Mapão.', 'error');
      } finally {
        setProcessandoUpload(false);
        setProgressoUpload('');
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [persistirMapoesParsed]
  );

  // Carregar o Mapão real do 6º Ano A (3º Bimestre) enviado como modelo
  const carregarMapaoModelo = useCallback(async () => {
    setProcessandoUpload(true);
    setProgressoUpload('Carregando Mapão oficial modelo (6º Ano A · 3º Bimestre)...');
    try {
      const resp = await fetch(MODELO_MAPAO_URL);
      if (!resp.ok) throw new Error('Arquivo modelo não localizado.');
      const blob = await resp.blob();
      const b64 = await fileToBase64(blob);

      const parseRes = await fetch('/api/conselho-especial/parse-mapao', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          files: [{ fileName: 'MAPAO_6_ANO_A_3_BIMESTRE_2026.pdf', fileBase64: b64 }]
        })
      });
      const parseData = await parseRes.json().catch(() => ({}));
      if (!parseRes.ok || !Array.isArray(parseData.mapoes) || parseData.mapoes.length === 0) {
        throw new Error(parseData.error || 'Falha ao processar o Mapão modelo.');
      }

      await persistirMapoesParsed(parseData.mapoes);
    } catch (err: any) {
      showFeedback(err?.message || 'Erro ao carregar o Mapão modelo.', 'error');
    } finally {
      setProcessandoUpload(false);
      setProgressoUpload('');
    }
  }, [persistirMapoesParsed]);

  // Atualizar deliberação, resultado final, turma seguinte ou AEE de um estudante (com upsert para turmas vindas dos Boletins)
  const salvarDeliberacaoAluno = useCallback(
    async (
      chaveTurma: string,
      chaveAluno: string,
      patch: Partial<DeliberacaoAlunoConselho>,
      silentToast = false
    ) => {
      const docAlvo = turmasCombinadas.find(t => t.chaveTurmaBimestre === chaveTurma);
      if (!docAlvo) return;

      const atual = docAlvo.deliberacoes?.[chaveAluno] || { status: 'PENDENTE' as StatusDeliberacaoConselho, parecer: '' };
      const proxima: DeliberacaoAlunoConselho = {
        ...atual,
        ...patch
      };

      const aplicarNaLista = (lista: ConselhoTurmaDoc[], atualizadoEm?: string, atualizadoPor?: string): ConselhoTurmaDoc[] => {
        const existe = lista.some(t => t.chaveTurmaBimestre === chaveTurma);
        const delibCompleta: DeliberacaoAlunoConselho = {
          ...proxima,
          ...(atualizadoEm ? { atualizadoEm } : {}),
          ...(atualizadoPor ? { atualizadoPor } : {})
        };
        if (!existe) {
          return [
            ...lista,
            {
              ...docAlvo,
              atualizadoEm: atualizadoEm || docAlvo.atualizadoEm,
              deliberacoes: {
                ...(docAlvo.deliberacoes || {}),
                [chaveAluno]: delibCompleta
              }
            }
          ];
        }
        return lista.map(t =>
          t.chaveTurmaBimestre === chaveTurma
            ? {
                ...t,
                atualizadoEm: atualizadoEm || t.atualizadoEm,
                deliberacoes: {
                  ...(t.deliberacoes || {}),
                  [chaveAluno]: delibCompleta
                }
              }
            : t
        );
      };

      // Atualização otimista imediata
      setTurmasDocs(prev => aplicarNaLista(prev));

      setSalvandoDeliberacao(true);
      try {
        const res = await fetch('/api/conselho-especial/deliberacao', {
          method: 'PATCH',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            chaveTurmaBimestre: chaveTurma,
            chaveAluno,
            deliberacao: proxima,
            metadataFallback: docAlvo.metadata,
            alunosRawFallback: docAlvo.alunosRaw
          })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Erro ao salvar deliberação.');
        }
        const data = await res.json();
        setTurmasDocs(prev => aplicarNaLista(prev, data.atualizadoEm, data.atualizadoPor));
        if (docAlvo.metadata?.bimestreKey === 'FINAL') {
          carregarBaseAlunos(true);
        }
        if (!silentToast) {
          const msgDossie =
            docAlvo.metadata?.bimestreKey === 'FINAL' && data.alunosDossieSincronizados > 0
              ? ' e gravado no Dossiê do estudante'
              : '';
          showFeedback(`Deliberação do conselho salva${msgDossie}.`, 'success');
        }
      } catch (err: any) {
        showFeedback(err?.message || 'Erro ao gravar deliberação.', 'error');
      } finally {
        setSalvandoDeliberacao(false);
      }
    },
    [turmasCombinadas, carregarBaseAlunos]
  );

  // Salvar lote de deliberações/resultados finais e turma do ano seguinte
  const salvarDeliberacoesLote = useCallback(
    async (modo: 'PREENCHER_INTELIGENTE' | 'APROVAR_TODOS_ATIVOS') => {
      if (!turmaAtualObj) return;
      const docAlvo = turmaAtualObj.doc;
      const updates: Record<string, Partial<DeliberacaoAlunoConselho>> = {};

      turmaAtualObj.alunos.forEach(a => {
        if (!a.isAtivo) {
          updates[a.chaveAluno] = {
            resultadoFinal: 'TRANSFERIDO_BAIXA',
            turmaAnoSeguinte: 'Transferido / Baixa'
          };
          return;
        }
        if (modo === 'APROVAR_TODOS_ATIVOS') {
          const sug = sugerirTurmasAnoSeguinte(docAlvo.metadata.turmaNormalizada, 'APROVADO');
          updates[a.chaveAluno] = {
            resultadoFinal: 'APROVADO',
            turmaAnoSeguinte: sug.sugestaoPrincipal
          };
          return;
        }
        // PREENCHER_INTELIGENTE: não sobrescreve quem já foi definido manualmente (diferente de PENDENTE)
        if (a.deliberacao.resultadoFinal && a.deliberacao.resultadoFinal !== 'PENDENTE') {
          return;
        }
        if (!a.precisaConversaConselho) {
          const sug = sugerirTurmasAnoSeguinte(docAlvo.metadata.turmaNormalizada, 'APROVADO');
          updates[a.chaveAluno] = {
            resultadoFinal: 'APROVADO',
            turmaAnoSeguinte: sug.sugestaoPrincipal
          };
        } else if (a.reprovandoPorFaltasGlobal && a.criticoNotas4Mais) {
          const sug = sugerirTurmasAnoSeguinte(docAlvo.metadata.turmaNormalizada, 'REPROVADO_AMBOS');
          updates[a.chaveAluno] = {
            resultadoFinal: 'REPROVADO_AMBOS',
            turmaAnoSeguinte: sug.sugestaoPrincipal
          };
        } else if (a.reprovandoPorFaltasGlobal) {
          const sug = sugerirTurmasAnoSeguinte(docAlvo.metadata.turmaNormalizada, 'REPROVADO_FALTA');
          updates[a.chaveAluno] = {
            resultadoFinal: 'REPROVADO_FALTA',
            turmaAnoSeguinte: sug.sugestaoPrincipal
          };
        } else if (a.criticoNotas4Mais) {
          const sug = sugerirTurmasAnoSeguinte(docAlvo.metadata.turmaNormalizada, 'REPROVADO_NOTA');
          updates[a.chaveAluno] = {
            resultadoFinal: 'REPROVADO_NOTA',
            turmaAnoSeguinte: sug.sugestaoPrincipal
          };
        } else {
          // Foco AEE ou 1-3 vermelhas -> sugere turma seguinte mas deixa PENDENTE para decisão do conselho
          const sug = sugerirTurmasAnoSeguinte(docAlvo.metadata.turmaNormalizada, 'PENDENTE');
          updates[a.chaveAluno] = {
            resultadoFinal: 'PENDENTE',
            turmaAnoSeguinte: a.deliberacao.turmaAnoSeguinte || sug.sugestaoPrincipal
          };
        }
      });

      if (Object.keys(updates).length === 0) {
        showFeedback('Todos os estudantes desta turma já possuem resultado final definido.', 'info');
        return;
      }

      setSalvandoLote(true);
      try {
        const res = await fetch('/api/conselho-especial/deliberacoes-lote', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            chaveTurmaBimestre: docAlvo.chaveTurmaBimestre,
            updates,
            metadataFallback: docAlvo.metadata,
            alunosRawFallback: docAlvo.alunosRaw
          })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Erro ao atualizar turma em lote.');
        }
        const data = await res.json();
        setTurmasDocs(prev => {
          const existe = prev.some(t => t.chaveTurmaBimestre === docAlvo.chaveTurmaBimestre);
          const novoItem: ConselhoTurmaDoc = {
            ...docAlvo,
            deliberacoes: data.deliberacoes || docAlvo.deliberacoes,
            atualizadoEm: data.atualizadoEm || docAlvo.atualizadoEm
          };
          return existe
            ? prev.map(t => (t.chaveTurmaBimestre === docAlvo.chaveTurmaBimestre ? novoItem : t))
            : [...prev, novoItem];
        });
        if (docAlvo.metadata?.bimestreKey === 'FINAL') {
          carregarBaseAlunos(true);
        }
        showFeedback(
          modo === 'APROVAR_TODOS_ATIVOS'
            ? 'Todos os estudantes ativos marcados como Aprovados para a próxima turma e sincronizados com o Dossiê.'
            : 'Sugestões inteligentes aplicadas e sincronizadas com o Dossiê.',
          'success'
        );
      } catch (err: any) {
        showFeedback(err?.message || 'Erro ao aplicar atualização em lote.', 'error');
      } finally {
        setSalvandoLote(false);
      }
    },
    [turmaAtualObj, carregarBaseAlunos]
  );

  // Salvar explicitamente todo o Conselho Final e turmas de destino da turma atual (para Dossiê e Virada de Ano)
  const salvarConselhoFinalCompletoTurma = useCallback(async () => {
    if (!turmaAtualObj) return;
    const docAlvo = turmaAtualObj.doc;
    const updates: Record<string, Partial<DeliberacaoAlunoConselho>> = {};

    turmaAtualObj.alunos.forEach(a => {
      const draftCustom = customTurmasDraft[a.chaveAluno];
      const turmaSegFinal =
        draftCustom !== undefined
          ? draftCustom.trim().toUpperCase()
          : String(a.deliberacao.turmaAnoSeguinte || '').trim().toUpperCase();

      if (!a.isAtivo) {
        updates[a.chaveAluno] = {
          status: a.deliberacao.status || 'PENDENTE',
          parecer: a.deliberacao.parecer || '',
          resultadoFinal: 'TRANSFERIDO_BAIXA',
          turmaAnoSeguinte: 'Transferido / Baixa'
        };
      } else {
        updates[a.chaveAluno] = {
          status: a.deliberacao.status || 'PENDENTE',
          parecer: a.deliberacao.parecer || '',
          resultadoFinal: a.deliberacao.resultadoFinal || 'PENDENTE',
          turmaAnoSeguinte: turmaSegFinal
        };
      }
    });

    if (Object.keys(updates).length === 0) {
      showFeedback('Nenhum estudante encontrado nesta turma para salvar.', 'warning');
      return;
    }

    setSalvandoLote(true);
    try {
      const res = await fetch('/api/conselho-especial/deliberacoes-lote', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          chaveTurmaBimestre: docAlvo.chaveTurmaBimestre,
          updates,
          metadataFallback: docAlvo.metadata,
          alunosRawFallback: docAlvo.alunosRaw
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Erro ao salvar fechamento final da turma.');
      }
      const data = await res.json();
      setTurmasDocs(prev => {
        const existe = prev.some(t => t.chaveTurmaBimestre === docAlvo.chaveTurmaBimestre);
        const novoItem: ConselhoTurmaDoc = {
          ...docAlvo,
          deliberacoes: data.deliberacoes || docAlvo.deliberacoes,
          atualizadoEm: data.atualizadoEm || docAlvo.atualizadoEm
        };
        return existe
          ? prev.map(t => (t.chaveTurmaBimestre === docAlvo.chaveTurmaBimestre ? novoItem : t))
          : [...prev, novoItem];
      });
      setCustomTurmasDraft({});
      if (docAlvo.metadata?.bimestreKey === 'FINAL') {
        carregarBaseAlunos(true);
      }
      showFeedback(
        `Conselho Final e turmas para ${anoLetivo + 1} salvos com sucesso (${data.alunosDossieSincronizados ?? 0} dossiês sincronizados)!`,
        'success'
      );
    } catch (err: any) {
      showFeedback(err?.message || 'Erro ao salvar Conselho Final da turma.', 'error');
    } finally {
      setSalvandoLote(false);
    }
  }, [turmaAtualObj, customTurmasDraft, anoLetivo, carregarBaseAlunos]);

  // Salvar síntese/observações gerais da turma
  const salvarObservacoesTurma = useCallback(async () => {
    if (!turmaAtualObj) return;
    const docAlvo = turmaAtualObj.doc;
    const chave = docAlvo.chaveTurmaBimestre;
    setSalvandoObsTurma(true);
    try {
      const res = await fetch('/api/conselho-especial/deliberacao', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          chaveTurmaBimestre: chave,
          observacoesGeraisTurma: obsTurmaDraft,
          metadataFallback: docAlvo.metadata,
          alunosRawFallback: docAlvo.alunosRaw
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Erro ao salvar observação.');
      }
      setTurmasDocs(prev => {
        const existe = prev.some(t => t.chaveTurmaBimestre === chave);
        return existe
          ? prev.map(t => (t.chaveTurmaBimestre === chave ? { ...t, observacoesGeraisTurma: obsTurmaDraft } : t))
          : [...prev, { ...docAlvo, observacoesGeraisTurma: obsTurmaDraft }];
      });
      showFeedback('Síntese geral da turma salva com sucesso.', 'success');
    } catch (err: any) {
      showFeedback(err?.message || 'Erro ao salvar síntese da turma.', 'error');
    } finally {
      setSalvandoObsTurma(false);
    }
  }, [turmaAtualObj, obsTurmaDraft]);

  // Salvar Ata do Conselho da Turma (para geração de PDF com assinaturas)
  const salvarAtaTurma = useCallback(
    async (ataData: AtaConselhoTurmaData) => {
      if (!turmaAtualObj) return;
      const docAlvo = turmaAtualObj.doc;
      const chave = docAlvo.chaveTurmaBimestre;
      const res = await fetch('/api/conselho-especial/deliberacao', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          chaveTurmaBimestre: chave,
          ataConselho: ataData,
          metadataFallback: docAlvo.metadata,
          alunosRawFallback: docAlvo.alunosRaw
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Erro ao salvar rascunho da Ata.');
      }
      const data = await res.json();
      const ataSalva: AtaConselhoTurmaData = {
        ...ataData,
        atualizadoEm: data.atualizadoEm,
        atualizadoPor: data.atualizadoPor
      };
      setTurmasDocs(prev => {
        const existe = prev.some(t => t.chaveTurmaBimestre === chave);
        return existe
          ? prev.map(t => (t.chaveTurmaBimestre === chave ? { ...t, ataConselho: ataSalva } : t))
          : [...prev, { ...docAlvo, ataConselho: ataSalva }];
      });
      showFeedback('Rascunho da Ata do Conselho salvo.', 'success');
    },
    [turmaAtualObj]
  );

  // Excluir Mapão de uma turma
  const excluirTurmaConselho = useCallback(async (chave: string) => {
    try {
      const res = await fetch(`/api/conselho-especial/turma/${encodeURIComponent(chave)}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Falha ao remover turma.');
      }
      setTurmasDocs(prev => prev.filter(t => t.chaveTurmaBimestre !== chave));
      setConfirmandoExclusao(null);
      showFeedback('Mapão da turma removido deste conselho.', 'info');
    } catch (err: any) {
      showFeedback(err?.message || 'Erro ao excluir turma.', 'error');
    }
  }, []);

  // Lista filtrada e ordenada de estudantes da turma atual
  const alunosExibidos = useMemo(() => {
    if (!turmaAtualObj) return [];
    let list = turmaAtualObj.alunos;

    switch (filtroAtivo) {
      case 'PAUTA':
        list = list.filter(a => a.isAtivo && a.precisaConversaConselho);
        break;
      case 'REPROVANDO_FALTAS':
        list = list.filter(a => a.isAtivo && a.reprovandoPorFaltasGlobal);
        break;
      case 'NOTAS_4_MAIS':
        list = list.filter(a => a.isAtivo && a.criticoNotas4Mais);
        break;
      case 'AEE':
        list = list.filter(a => a.isAtivo && a.isAEE);
        break;
      case 'ATIVOS':
        list = list.filter(a => a.isAtivo);
        break;
      case 'TRANSFERIDOS':
        list = list.filter(a => !a.isAtivo);
        break;
    }

    if (filtroDisciplinaVermelha !== 'TODAS') {
      list = list.filter(a => a.notasVermelhas.some(n => n.nome === filtroDisciplinaVermelha));
    }

    const q = buscaAluno.trim().toLowerCase();
    if (q) {
      list = list.filter(
        a =>
          a.nome.toLowerCase().includes(q) ||
          String(a.numChamada).includes(q) ||
          (a.tutor && a.tutor.toLowerCase().includes(q)) ||
          a.notasVermelhas.some(n => n.nome.toLowerCase().includes(q) || n.nomeCurto.toLowerCase().includes(q))
      );
    }

    return [...list].sort((a, b) => {
      switch (ordenacao) {
        case 'criticidade':
          return b.scoreGravidade - a.scoreGravidade || (a.freqAnualNum ?? 100) - (b.freqAnualNum ?? 100) || a.numChamada - b.numChamada;
        case 'freq_asc':
          return (a.freqAnualNum ?? 100) - (b.freqAnualNum ?? 100) || b.qtdNotasVermelhas - a.qtdNotasVermelhas;
        case 'vermelhas_desc':
          return b.qtdNotasVermelhas - a.qtdNotasVermelhas || (a.freqAnualNum ?? 100) - (b.freqAnualNum ?? 100);
        case 'chamada':
          return a.numChamada - b.numChamada;
        case 'nome':
          return a.nome.localeCompare(b.nome, 'pt-BR');
      }
    });
  }, [turmaAtualObj, filtroAtivo, filtroDisciplinaVermelha, buscaAluno, ordenacao]);

  // Totais consolidados da escola no bimestre (para Panorama Geral)
  const resumoEscolaBimestre = useMemo(() => {
    return turmasClassificadas.reduce(
      (acc, item) => {
        acc.turmas += 1;
        acc.ativos += item.stats.totalAtivos;
        acc.reprovandoFaltas += item.stats.reprovandoFaltasCount;
        acc.criticos4Mais += item.stats.criticosNotas4MaisCount;
        acc.casosAEE += item.stats.casosAEECount;
        acc.pautaTotal += item.stats.pautaConselhoCount;
        acc.deliberados += item.stats.deliberadosCount;
        return acc;
      },
      { turmas: 0, ativos: 0, reprovandoFaltas: 0, criticos4Mais: 0, casosAEE: 0, pautaTotal: 0, deliberados: 0 }
    );
  }, [turmasClassificadas]);

  // Exportar Excel da turma selecionada
  const handleExportarExcelTurma = () => {
    if (!turmaAtualObj) return;
    const isConselhoFinal = turmaAtualObj.doc.metadata.bimestreKey === 'FINAL';
    const rows = turmaAtualObj.alunos
      .filter(a => a.isAtivo)
      .sort((a, b) => b.scoreGravidade - a.scoreGravidade || a.numChamada - b.numChamada)
      .map(a => ({
        'Nº': a.numChamada,
        Estudante: a.nome,
        RA: a.ra || '',
        AEE: a.isAEE ? 'SIM' : 'NÃO',
        'Enquadramento Conselho': PRIORIDADE_LABELS[a.prioridade],
        'Reprovando Faltas (<75%)': a.reprovandoPorFaltasGlobal ? 'SIM' : 'NÃO',
        'Freq. Anual Global': a.freqAnualStr,
        'Faltas Anuais (FTAn)': a.faltasTotalAno,
        'Freq. Bimestre': a.freqBimestreStr,
        'Faltas Bimestre (TF)': a.totalFaltasBimestre,
        'Reposições (AC)': a.totalAusenciasCompensadas,
        'Qtd. Notas Vermelhas': a.qtdNotasVermelhas,
        'Disciplinas Vermelhas': a.notasVermelhas.map(n => `${n.nomeCurto} (${n.mencao})`).join('; '),
        'Média Global': a.mediaGlobalNotas ?? '',
        'Pauta Conselho': a.precisaConversaConselho ? 'SIM' : 'NÃO',
        Deliberação: DELIBERACAO_LABELS[a.deliberacao.status],
        ...(isConselhoFinal
          ? {
              'Resultado Final': RESULTADO_FINAL_LABELS[a.deliberacao.resultadoFinal || 'PENDENTE'],
              [`Turma ${anoLetivo + 1}`]: a.deliberacao.turmaAnoSeguinte || ''
            }
          : {}),
        'Parecer Confidencial': a.deliberacao.parecer || ''
      }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, turmaAtualObj.doc.metadata.turmaNormalizada.slice(0, 30));
    const slug = turmaAtualObj.doc.metadata.turmaNormalizada.replace(/[^A-Z0-9]+/gi, '_');
    XLSX.writeFile(wb, `Conselho_${slug}_${turmaAtualObj.doc.metadata.bimestreKey}_${anoLetivo}.xlsx`);
  };

  const handleExportarPdfTurma = () => {
    if (!turmaAtualObj) return;
    const userNome =
      (typeof window !== 'undefined' && (window as any).obterIdentificacaoUsuarioCompleta?.()?.nome) || '';
    exportarPautaConselhoTurmaPDF(
      turmaAtualObj.doc.metadata,
      turmaAtualObj.alunos,
      obsTurmaDraft || turmaAtualObj.doc.observacoesGeraisTurma,
      userNome
    );
  };

  // Disciplinas que têm ao menos 1 nota vermelha na turma (para o seletor de filtro por disciplina)
  const disciplinasComVermelhaNaTurma = useMemo(() => {
    if (!turmaAtualObj) return [];
    const counts = new Map<string, { nome: string; curto: string; qtd: number }>();
    turmaAtualObj.alunos
      .filter(a => a.isAtivo)
      .forEach(a => {
        a.notasVermelhas.forEach(n => {
          const cur = counts.get(n.nome) || { nome: n.nome, curto: n.nomeCurto, qtd: 0 };
          cur.qtd += 1;
          counts.set(n.nome, cur);
        });
      });
    return Array.from(counts.values()).sort((a, b) => b.qtd - a.qtd);
  }, [turmaAtualObj]);

  const abrirFichaAlunoNaEscola = (ra: string | null) => {
    if (!ra) return;
    if (typeof window !== 'undefined') {
      if (typeof (window as any).navegarEAbrirFichaAluno === 'function') {
        (window as any).navegarEAbrirFichaAluno(ra);
      } else if (typeof (window as any).abrirFichaAluno === 'function') {
        (window as any).abrirFichaAluno(ra);
      }
    }
  };

  return (
    <div className="w-full min-h-screen bg-slate-50 text-slate-900">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* TOP WORKSPACE HEADER */}
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 text-xs text-slate-500 font-medium flex-wrap">
              <Lock className="w-3.5 h-3.5 text-slate-700 shrink-0" />
              <span>Especial</span>
              <span aria-hidden="true">·</span>
              <span>Acesso restrito: Direção, Vice-Direção e CGPG</span>
              <span aria-hidden="true">·</span>
              <select
                value={anoLetivo}
                onChange={e => setAnoLetivo(Number(e.target.value) || anoVigenteSistema)}
                aria-label="Selecionar ano letivo do Conselho"
                className="px-2 py-0.5 text-xs font-mono font-bold tabular-nums bg-slate-100 border border-slate-200 rounded text-slate-800 cursor-pointer focus:outline-none"
              >
                {Array.from(new Set([anoVigenteSistema - 1, anoVigenteSistema, anoVigenteSistema + 1]))
                  .filter(y => y >= 2026)
                  .sort((a, b) => a - b)
                  .map(y => (
                    <option key={y} value={y}>
                      {y}{y === anoVigenteSistema ? ' (Vigente)' : ''}
                    </option>
                  ))}
              </select>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              Conselho de Bimestre — Análise Oficial do Mapão
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {/* Seletor de Bimestre */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200">
              {BIMESTRES_OPCOES.map(b => {
                const qtd = contagemPorBimestre[b.key] || 0;
                const active = bimestreAtivo === b.key;
                return (
                  <button
                    key={b.key}
                    type="button"
                    onClick={() => setBimestreAtivo(b.key)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1.5 ${
                      active
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <span>{b.label}</span>
                    {qtd > 0 && (
                      <span className="font-mono tabular-nums text-[11px] text-slate-500">
                        ({qtd})
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {turmaAtualObj && modoVisao === 'TURMA' && (
              <>
                <button
                  type="button"
                  onClick={() => setSubAbaTurma('ATA')}
                  className={`px-3.5 py-2 text-xs font-semibold border rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                    subAbaTurma === 'ATA'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'text-slate-700 bg-white border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <ScrollText className="w-3.5 h-3.5" />
                  <span>Ata PDF</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportarPdfTurma}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Pauta PDF</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportarExcelTurma}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Excel</span>
                </button>
              </>
            )}

            <button
              type="button"
              disabled={processandoUpload}
              onClick={() => {
                const painelJaVisivel = mostrarPainelUpload || (!carregando && turmasDoBimestre.length === 0);
                if (painelJaVisivel) {
                  fileInputRef.current?.click();
                } else {
                  setMostrarPainelUpload(true);
                }
              }}
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Subir Mapão</span>
            </button>
          </div>
        </div>

        {/* INPUT DE ARQUIVO OCULTO */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.xlsx,.xls"
          multiple
          className="hidden"
          onChange={e => {
            if (e.target.files && e.target.files.length > 0) {
              processarArquivosMapao(e.target.files);
            }
          }}
        />

        {/* ÁREA DE UPLOAD (EXPANSÍVEL OU PADRÃO QUANDO NÃO HÁ TURMAS NO BIMESTRE) */}
        {(mostrarPainelUpload || (!carregando && turmasDoBimestre.length === 0)) && (
          <div
            onDragOver={e => {
              e.preventDefault();
              setDragAtivo(true);
            }}
            onDragLeave={() => setDragAtivo(false)}
            onDrop={e => {
              e.preventDefault();
              setDragAtivo(false);
              if (e.dataTransfer.files?.length) {
                processarArquivosMapao(e.dataTransfer.files);
              }
            }}
            className={`bg-white border rounded-xl p-6 transition-colors ${
              dragAtivo ? 'border-slate-900 bg-slate-50' : 'border-slate-200'
            }`}
          >
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              <div className="space-y-1.5 max-w-2xl">
                <h2 className="text-base font-bold text-slate-900">
                  Importar Mapão Oficial da SED (PDF ou Excel)
                </h2>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Envie um ou vários arquivos do Mapão ("Registro e Controle do Rendimento Escolar") de uma só vez.
                  O sistema lê notas, faltas, ausências compensadas (AC), frequência do bimestre e frequência global anual,
                  cruza automaticamente com o cadastro de AEE e separa os casos críticos para o Conselho.
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-slate-500">
                  <span>Aceita envio em lote (várias turmas)</span>
                  <span aria-hidden="true">·</span>
                  <span>Preserva pareceres já registrados ao reenviar a turma</span>
                  <span aria-hidden="true">·</span>
                  <span>Separa automaticamente alunos Transferidos</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  disabled={processandoUpload}
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer"
                >
                  {processandoUpload ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  <span>{processandoUpload ? progressoUpload || 'Processando...' : 'Selecionar PDF / Excel'}</span>
                </button>

                <button
                  type="button"
                  disabled={processandoUpload}
                  onClick={carregarMapaoModelo}
                  className="px-4 py-2.5 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer"
                >
                  <BookOpen className="w-4 h-4" />
                  <span>Carregar Modelo (6º Ano A · 3º Bim)</span>
                </button>

                {bimestreAtivo === 'FINAL' &&
                  turmasDoBimestre.length === 0 &&
                  turmasBaseUltimoBimestre.turmas.length > 0 && (
                    <button
                      type="button"
                      disabled={processandoUpload}
                      onClick={iniciarConselhoFinalDeBase}
                      className="px-4 py-2.5 text-sm font-semibold text-indigo-900 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer"
                    >
                      <Award className="w-4 h-4 text-indigo-700" />
                      <span>
                        Iniciar Final com Base no {turmasBaseUltimoBimestre.bimKey} ({turmasBaseUltimoBimestre.turmas.length} turmas)
                      </span>
                    </button>
                  )}

                {turmasDoBimestre.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setMostrarPainelUpload(false)}
                    className="p-2.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                    title="Fechar painel de envio"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ESTADO DE ERRO DE CARGA */}
        {erroCarga && (
          <div className="bg-white border border-rose-200 rounded-xl p-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-sm text-rose-700 font-medium">
              <ShieldAlert className="w-5 h-5 shrink-0" />
              <span>{erroCarga}</span>
            </div>
            <button
              type="button"
              onClick={carregarTurmasConselho}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer whitespace-nowrap"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {/* LOADING SKELETON */}
        {carregando && (
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="h-5 w-64 bg-slate-200 rounded animate-pulse" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(n => (
                <div key={n} className="h-24 bg-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
            <div className="h-64 bg-slate-100 rounded-lg animate-pulse" />
          </div>
        )}

        {/* BARRA DE SELEÇÃO DE TURMA + PANORAMA GERAL */}
        {!carregando && turmasClassificadas.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 px-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                <Layers className="w-4 h-4 text-slate-500" />
                <span>
                  Turmas carregadas no {BIMESTRES_OPCOES.find(b => b.key === bimestreAtivo)?.label} ({turmasClassificadas.length})
                </span>
                <span aria-hidden="true" className="text-slate-300">·</span>
                <span className="font-mono tabular-nums text-rose-700">
                  {resumoEscolaBimestre.reprovandoFaltas} reprovando faltas
                </span>
                <span aria-hidden="true" className="text-slate-300">·</span>
                <span className="font-mono tabular-nums text-orange-700">
                  {resumoEscolaBimestre.criticos4Mais} com 4+ vermelhas
                </span>
                <span aria-hidden="true" className="text-slate-300">·</span>
                <span className="font-mono tabular-nums text-indigo-700">
                  {resumoEscolaBimestre.casosAEE} AEE
                </span>
              </div>

              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setModoVisao('TURMA')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    modoVisao === 'TURMA' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Tela por Turma
                </button>
                <button
                  type="button"
                  onClick={() => setModoVisao('PANORAMA')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    modoVisao === 'PANORAMA' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Panorama Consolidado ({turmasClassificadas.length})
                </button>
              </div>
            </div>

            {modoVisao === 'TURMA' && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {turmasClassificadas.map(({ doc, stats }) => {
                  const selected = turmaAtualObj?.doc.chaveTurmaBimestre === doc.chaveTurmaBimestre;
                  const temCritico = stats.reprovandoFaltasCount > 0 || stats.criticosNotas4MaisCount > 0;
                  return (
                    <button
                      key={doc.chaveTurmaBimestre}
                      type="button"
                      onClick={() => setChaveTurmaSelecionada(doc.chaveTurmaBimestre)}
                      className={`px-3.5 py-2.5 rounded-lg border text-left transition-colors shrink-0 cursor-pointer min-w-[175px] ${
                        selected
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold whitespace-nowrap">{doc.metadata.turmaNormalizada}</span>
                        <span
                          className={`text-[11px] font-mono tabular-nums ${
                            selected ? 'text-slate-300' : 'text-slate-500'
                          }`}
                        >
                          {stats.totalAtivos} ativos
                        </span>
                      </div>
                      <div
                        className={`text-[11px] font-mono tabular-nums mt-1 flex items-center gap-1.5 ${
                          selected ? 'text-slate-300' : temCritico ? 'text-rose-700 font-semibold' : 'text-slate-500'
                        }`}
                      >
                        <span>{stats.reprovandoFaltasCount} falt.</span>
                        <span aria-hidden="true">·</span>
                        <span>{stats.criticosNotas4MaisCount} 4+v</span>
                        <span aria-hidden="true">·</span>
                        <span>{stats.casosAEECount} AEE</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* MODO 1: PANORAMA CONSOLIDADO DE TODAS AS TURMAS DO BIMESTRE */}
        {/* ============================================================ */}
        {!carregando && modoVisao === 'PANORAMA' && turmasClassificadas.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Panorama Geral da Escola — {BIMESTRES_OPCOES.find(b => b.key === bimestreAtivo)?.label} ({anoLetivo})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Clique em qualquer turma para abrir a pauta detalhada de estudantes e registrar deliberações.
                </p>
              </div>
              <div className="text-xs font-mono tabular-nums text-slate-600">
                {resumoEscolaBimestre.deliberados} / {resumoEscolaBimestre.pautaTotal} casos deliberados
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Turma</th>
                    <th className="py-3 px-3 text-right">Ativos</th>
                    <th className="py-3 px-3 text-right">Reprov. Faltas (&lt;75%)</th>
                    <th className="py-3 px-3 text-right">4+ Notas Vermelhas</th>
                    <th className="py-3 px-3 text-right">Casos AEE</th>
                    <th className="py-3 px-3 text-right">Pauta Conselho</th>
                    <th className="py-3 px-3 text-right">Freq. Anual Média</th>
                    <th className="py-3 px-3 text-right">Média Notas</th>
                    <th className="py-3 px-4 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {turmasClassificadas.map(({ doc, stats }) => (
                    <tr
                      key={doc.chaveTurmaBimestre}
                      onClick={() => {
                        setChaveTurmaSelecionada(doc.chaveTurmaBimestre);
                        setModoVisao('TURMA');
                      }}
                      className="hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{doc.metadata.turmaNormalizada}</div>
                        <div className="text-xs text-slate-500">
                          {doc.metadata.tipoFechamento} · {doc.metadata.totalAulasDadas || '—'} aulas dadas
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                        {stats.totalAtivos}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        <span className={stats.reprovandoFaltasCount > 0 ? 'font-bold text-rose-700' : 'text-slate-400'}>
                          {stats.reprovandoFaltasCount}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        <span className={stats.criticosNotas4MaisCount > 0 ? 'font-bold text-orange-700' : 'text-slate-400'}>
                          {stats.criticosNotas4MaisCount}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        <span className={stats.casosAEECount > 0 ? 'font-bold text-indigo-700' : 'text-slate-400'}>
                          {stats.casosAEECount}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {stats.pautaConselhoCount}
                        <span className="text-xs font-normal text-slate-500 ml-1">
                          ({stats.deliberadosCount} ok)
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                        {stats.mediaFreqAnual !== null ? `${stats.mediaFreqAnual}%` : '—'}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                        {stats.mediaNotasTurma !== null ? stats.mediaNotasTurma.toFixed(1) : '—'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700">
                          Abrir <ChevronRight className="w-3.5 h-3.5" />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* MODO 2: TELA POR TURMA (DETALHAMENTO COMPLETO DO CONSELHO)  */}
        {/* ============================================================ */}
        {!carregando && modoVisao === 'TURMA' && turmaAtualObj && (
          <div className="space-y-5">
            {/* CABEÇALHO CONTEXTUAL DA TURMA */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-1">
              <div>
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2.5">
                  <span>{turmaAtualObj.doc.metadata.turmaNormalizada}</span>
                  <span className="text-sm font-medium text-slate-500">
                    {turmaAtualObj.doc.metadata.tipoFechamento}
                  </span>
                </h2>
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500 mt-0.5">
                  <span>{turmaAtualObj.doc.metadata.turmaOriginal}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {turmaAtualObj.stats.totalAtivos} ativos / {turmaAtualObj.stats.totalTransferidos} transferidos
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {turmaAtualObj.doc.metadata.totalAulasDadas || '—'} aulas dadas no bimestre
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {turmaAtualObj.stats.totalAC} ausências compensadas (AC)
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    Freq. média global: {turmaAtualObj.stats.mediaFreqAnual ?? '—'}%
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="text-slate-600 font-medium">
                    {turmaAtualObj.doc.origemDados === 'BOLETIM_SISTEMA'
                      ? 'Dados sincronizados dos Boletins do Sistema'
                      : 'Mapão Oficial Importado'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {turmaAtualObj.doc.origemDados !== 'BOLETIM_SISTEMA' && (
                  confirmandoExclusao === turmaAtualObj.doc.chaveTurmaBimestre ? (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-rose-700 font-semibold">Excluir este Mapão?</span>
                      <button
                        type="button"
                        onClick={() => excluirTurmaConselho(turmaAtualObj.doc.chaveTurmaBimestre)}
                        className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-md cursor-pointer"
                      >
                        Confirmar
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmandoExclusao(null)}
                        className="px-2.5 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold rounded-md cursor-pointer"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmandoExclusao(turmaAtualObj.doc.chaveTurmaBimestre)}
                      className="px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Remover Mapão</span>
                    </button>
                  )
                )}
              </div>
            </div>

            {/* SUB-ABAS DA TURMA: TRIAGEM DO MAPÃO | RESULTADO FINAL (APENAS NO FINAL) | ATA OFICIAL (PDF) */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl p-2">
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSubAbaTurma('TRIAGEM')}
                  className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                    subAbaTurma === 'TRIAGEM'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>1. Análise e Triagem do Mapão</span>
                </button>
                {bimestreAtivo === 'FINAL' && (
                  <button
                    type="button"
                    onClick={() => setSubAbaTurma('RESULTADO_FINAL')}
                    className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                      subAbaTurma === 'RESULTADO_FINAL'
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    <Award className="w-3.5 h-3.5" />
                    <span>2. Resultado Final e Turma {anoLetivo + 1}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSubAbaTurma('ATA')}
                  className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                    subAbaTurma === 'ATA'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <ScrollText className="w-3.5 h-3.5" />
                  <span>
                    {bimestreAtivo === 'FINAL' ? '3.' : '2.'} Ata Oficial do Conselho e Assinaturas (PDF)
                  </span>
                </button>
              </div>

              {bimestreAtivo === 'FINAL' &&
                (turmaAtualObj.stats.aprovadosCount +
                  turmaAtualObj.stats.aprovadosConselhoCount +
                  turmaAtualObj.stats.reprovadosCount) > 0 && (
                  <div className="text-xs font-mono tabular-nums text-slate-600 px-2">
                    Final:{' '}
                    <span className="font-bold text-emerald-700">
                      {turmaAtualObj.stats.aprovadosCount + turmaAtualObj.stats.aprovadosConselhoCount} aprov.
                    </span>
                    {' · '}
                    <span className="font-bold text-rose-700">{turmaAtualObj.stats.reprovadosCount} reprov.</span>
                    {' · '}
                    <span>{turmaAtualObj.stats.pendentesFinalCount} pendentes</span>
                  </div>
                )}
            </div>

            {/* CONTEÚDO SUB-ABA: ATA OFICIAL DO CONSELHO E ASSINATURAS */}
            {subAbaTurma === 'ATA' && (
              <ConselhoAtaEditor
                chaveTurmaBimestre={turmaAtualObj.doc.chaveTurmaBimestre}
                metadata={turmaAtualObj.doc.metadata}
                alunos={turmaAtualObj.alunos}
                ataInicial={turmaAtualObj.doc.ataConselho}
                observacoesGeraisTurma={obsTurmaDraft || turmaAtualObj.doc.observacoesGeraisTurma}
                onSalvarAta={salvarAtaTurma}
              />
            )}

            {/* CONTEÚDO SUB-ABA 2 (EXCLUSIVA DO CONSELHO FINAL): APROVADO / REPROVADO E TURMA DO ANO SEGUINTE */}
            {bimestreAtivo === 'FINAL' && subAbaTurma === 'RESULTADO_FINAL' && (
              <div className="space-y-4">
                <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                  <div className="space-y-1">
                    <h3 className="text-base font-bold text-slate-900">
                      Conselho Final — Deliberação de Promoção, Retenção e Turma {anoLetivo + 1}
                    </h3>
                    <p className="text-xs text-slate-600">
                      Defina quem foi Aprovado, Aprovado pelo Conselho ou Reprovado e selecione a turma de destino no ano seguinte ({anoLetivo + 1}). Os dados entram automaticamente na Ata Oficial em PDF e no Excel.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={salvandoLote}
                      onClick={() => salvarDeliberacoesLote('PREENCHER_INTELIGENTE')}
                      className="px-3.5 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Sugerir Automaticamente (Pendentes)</span>
                    </button>
                    <button
                      type="button"
                      disabled={salvandoLote}
                      onClick={() => salvarDeliberacoesLote('APROVAR_TODOS_ATIVOS')}
                      className="px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Aprovar Todos os Ativos → Próxima Turma</span>
                    </button>
                    <button
                      type="button"
                      disabled={salvandoLote}
                      onClick={salvarConselhoFinalCompletoTurma}
                      className="px-4 py-2 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer shadow-xs"
                    >
                      {salvandoLote ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      <span>{salvandoLote ? 'Salvando...' : `Salvar Resultado Final e Turmas ${anoLetivo + 1}`}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubAbaTurma('ATA')}
                      className="px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                    >
                      <ScrollText className="w-3.5 h-3.5" />
                      <span>Ir para Ata PDF</span>
                    </button>
                  </div>
                </div>

                {/* Resumo Quantitativo do Conselho Final + Mapa de Destinos */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <div className="text-xs font-semibold text-emerald-700">Aprovados / Promovidos</div>
                    <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                      {turmaAtualObj.stats.aprovadosCount}
                    </div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <div className="text-xs font-semibold text-indigo-700">Aprovados pelo Conselho</div>
                    <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                      {turmaAtualObj.stats.aprovadosConselhoCount}
                    </div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <div className="text-xs font-semibold text-rose-700">Reprovados (Retidos)</div>
                    <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                      {turmaAtualObj.stats.reprovadosCount}
                    </div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <div className="text-xs font-semibold text-slate-600">A Definir / Pendentes</div>
                    <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                      {turmaAtualObj.stats.pendentesFinalCount}
                    </div>
                  </div>
                </div>

                {Object.keys(turmaAtualObj.stats.destinoTurmasMap).length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <span className="font-bold text-slate-700">Enturmação {anoLetivo + 1}:</span>
                    {Object.entries(turmaAtualObj.stats.destinoTurmasMap)
                      .sort((a, b) => b[1] - a[1])
                      .map(([destino, qtd]) => (
                        <span key={destino} className="font-mono tabular-nums text-slate-800">
                          <span className="font-semibold">{destino}</span>: {qtd}
                        </span>
                      ))}
                  </div>
                )}

                {/* Tabela de Fechamento Final (Todos os estudantes em ordem de chamada) */}
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                          <th className="py-2.5 px-3 w-11 text-center">Nº</th>
                          <th className="py-2.5 px-3 min-w-[220px]">Estudante</th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">Freq. Anual</th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">Média</th>
                          <th className="py-2.5 px-3 text-center whitespace-nowrap">Verm.</th>
                          <th className="py-2.5 px-3 min-w-[215px]">Resultado Final</th>
                          <th className="py-2.5 px-3 min-w-[215px]">Turma em {anoLetivo + 1}</th>
                          <th className="py-2.5 px-3 text-right w-20">Detalhe</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-sm">
                        {[...turmaAtualObj.alunos]
                          .sort((a, b) => a.numChamada - b.numChamada)
                          .map(aluno => {
                            const resFinal = aluno.isAtivo
                              ? aluno.deliberacao.resultadoFinal || 'PENDENTE'
                              : 'TRANSFERIDO_BAIXA';
                            const sugestaoObj = sugerirTurmasAnoSeguinte(
                              turmaAtualObj.doc.metadata.turmaNormalizada,
                              resFinal
                            );
                            const valorTurmaSeg = aluno.isAtivo
                              ? aluno.deliberacao.turmaAnoSeguinte || ''
                              : 'Transferido / Baixa';
                            const isCustomInput =
                              Boolean(outraTurmaAluno[aluno.chaveAluno]) ||
                              (valorTurmaSeg !== '' && !sugestaoObj.opcoes.includes(valorTurmaSeg));

                            const rowTint = !aluno.isAtivo
                              ? 'bg-slate-50/70 text-slate-400'
                              : resFinal === 'REPROVADO_AMBOS' ||
                                resFinal === 'REPROVADO_FALTA' ||
                                resFinal === 'REPROVADO_NOTA'
                              ? 'bg-rose-50/50'
                              : resFinal === 'APROVADO' || resFinal === 'APROVADO_CONSELHO'
                              ? 'bg-emerald-50/35'
                              : aluno.precisaConversaConselho
                              ? 'bg-amber-50/35'
                              : 'bg-white';

                            return (
                              <tr key={aluno.chaveAluno} className={`${rowTint} transition-colors`}>
                                <td className="py-2.5 px-3 text-center font-mono tabular-nums text-xs font-semibold text-slate-500">
                                  {aluno.numChamada}
                                </td>
                                <td className="py-2.5 px-3">
                                  <div className="font-semibold text-slate-900 leading-snug">{aluno.nome}</div>
                                  <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2">
                                    {aluno.isAEE && (
                                      <span className="font-bold text-indigo-700 inline-flex items-center gap-1">
                                        <Accessibility className="w-3 h-3" />
                                        AEE
                                      </span>
                                    )}
                                    {!aluno.isAtivo && <span>{aluno.situacao}</span>}
                                    {aluno.isAtivo && aluno.precisaConversaConselho && (
                                      <span className="text-amber-800 font-medium">Caso em pauta</span>
                                    )}
                                    {aluno.boletimHistorico.length > 0 && (
                                      <span className="font-mono">
                                        {aluno.boletimHistorico.length} bim. no boletim
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td
                                  className={`py-2.5 px-3 text-right font-mono tabular-nums text-xs font-bold ${
                                    aluno.reprovandoPorFaltasGlobal ? 'text-rose-700' : 'text-slate-800'
                                  }`}
                                >
                                  {aluno.freqAnualStr}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono tabular-nums text-xs font-semibold text-slate-800">
                                  {aluno.mediaGlobalNotas !== null ? aluno.mediaGlobalNotas.toFixed(1) : '—'}
                                </td>
                                <td
                                  className={`py-2.5 px-3 text-center font-mono tabular-nums text-xs font-bold ${
                                    aluno.criticoNotas4Mais
                                      ? 'text-orange-700'
                                      : aluno.qtdNotasVermelhas > 0
                                      ? 'text-rose-700'
                                      : 'text-slate-400'
                                  }`}
                                >
                                  {aluno.qtdNotasVermelhas}
                                </td>
                                <td className="py-2.5 px-3">
                                  {aluno.isAtivo ? (
                                    <select
                                      value={resFinal}
                                      onChange={e => {
                                        const novoRes = e.target.value as ResultadoFinalConselho;
                                        const novaSug = sugerirTurmasAnoSeguinte(
                                          turmaAtualObj.doc.metadata.turmaNormalizada,
                                          novoRes
                                        );
                                        salvarDeliberacaoAluno(
                                          turmaAtualObj.doc.chaveTurmaBimestre,
                                          aluno.chaveAluno,
                                          {
                                            resultadoFinal: novoRes,
                                            turmaAnoSeguinte:
                                              novoRes === 'PENDENTE'
                                                ? aluno.deliberacao.turmaAnoSeguinte || ''
                                                : novaSug.sugestaoPrincipal
                                          },
                                          true
                                        );
                                      }}
                                      className={`w-full px-2.5 py-1.5 text-xs font-semibold rounded-md border cursor-pointer focus:outline-none ${
                                        resFinal === 'APROVADO' || resFinal === 'APROVADO_CONSELHO'
                                          ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                                          : resFinal === 'REPROVADO_FALTA' ||
                                            resFinal === 'REPROVADO_NOTA' ||
                                            resFinal === 'REPROVADO_AMBOS'
                                          ? 'bg-rose-50 border-rose-300 text-rose-800'
                                          : 'bg-white border-slate-300 text-slate-700'
                                      }`}
                                    >
                                      {(Object.keys(RESULTADO_FINAL_LABELS) as ResultadoFinalConselho[]).map(k => (
                                        <option key={k} value={k}>
                                          {RESULTADO_FINAL_LABELS[k]}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <span className="text-xs font-medium text-slate-500">Transferido / Baixa</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3">
                                  {aluno.isAtivo ? (
                                    isCustomInput ? (
                                      <div className="flex items-center gap-1">
                                        <input
                                          type="text"
                                          value={customTurmasDraft[aluno.chaveAluno] ?? valorTurmaSeg}
                                          placeholder={`Ex: ${sugestaoObj.sugestaoPrincipal}`}
                                          onChange={e =>
                                            setCustomTurmasDraft(prev => ({
                                              ...prev,
                                              [aluno.chaveAluno]: e.target.value.toUpperCase()
                                            }))
                                          }
                                          onBlur={e => {
                                            const valFinal = e.target.value.trim().toUpperCase();
                                            setCustomTurmasDraft(prev => {
                                              const next = { ...prev };
                                              delete next[aluno.chaveAluno];
                                              return next;
                                            });
                                            salvarDeliberacaoAluno(
                                              turmaAtualObj.doc.chaveTurmaBimestre,
                                              aluno.chaveAluno,
                                              { turmaAnoSeguinte: valFinal },
                                              true
                                            );
                                          }}
                                          className="w-full px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setOutraTurmaAluno(prev => ({ ...prev, [aluno.chaveAluno]: false }));
                                            setCustomTurmasDraft(prev => {
                                              const next = { ...prev };
                                              delete next[aluno.chaveAluno];
                                              return next;
                                            });
                                          }}
                                          className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                                          title="Voltar para lista sugerida"
                                        >
                                          <X className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    ) : (
                                      <select
                                        value={valorTurmaSeg}
                                        onChange={e => {
                                          const val = e.target.value;
                                          if (val === '__OUTRA__') {
                                            setOutraTurmaAluno(prev => ({ ...prev, [aluno.chaveAluno]: true }));
                                            setCustomTurmasDraft(prev => ({
                                              ...prev,
                                              [aluno.chaveAluno]: valorTurmaSeg
                                            }));
                                            return;
                                          }
                                          salvarDeliberacaoAluno(
                                            turmaAtualObj.doc.chaveTurmaBimestre,
                                            aluno.chaveAluno,
                                            { turmaAnoSeguinte: val },
                                            true
                                          );
                                        }}
                                        className="w-full px-2.5 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded-md text-slate-900 cursor-pointer focus:outline-none"
                                      >
                                        <option value="">Selecionar turma {anoLetivo + 1}...</option>
                                        {sugestaoObj.opcoes.map(op => (
                                          <option key={op} value={op}>
                                            {op === sugestaoObj.sugestaoPrincipal ? `${op} (Sugerida)` : op}
                                          </option>
                                        ))}
                                        <option value="__OUTRA__">Digitar outra turma...</option>
                                      </select>
                                    )
                                  ) : (
                                    <span className="text-xs text-slate-400">Transferido</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-right">
                                  <button
                                    type="button"
                                    onClick={() => setAlunoDetalheChave(aluno.chaveAluno)}
                                    className="px-2 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:border-slate-400 rounded-md inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                    <span>Ver</span>
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs text-slate-600">
                      Os destinos salvos aqui serão usados pela <strong>Virada de Ano Letivo</strong> (Configurações → Ferramenta B) e gravados no Dossiê.
                    </span>
                    <button
                      type="button"
                      disabled={salvandoLote}
                      onClick={salvarConselhoFinalCompletoTurma}
                      className="px-4 py-2 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      {salvandoLote ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      <span>{salvandoLote ? 'Salvando...' : `Salvar Conselho Final e Turmas ${anoLetivo + 1}`}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* CONTEÚDO SUB-ABA 1: ANÁLISE E TRIAGEM DO MAPÃO */}
            {subAbaTurma === 'TRIAGEM' && (
              <>
            {/* 4 INDICADORES PRINCIPAIS DA TURMA (CLICÁVEIS PARA FILTRAR) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* KPI 1: REPROVANDO POR FALTAS GLOBAL */}
              <button
                type="button"
                onClick={() => setFiltroAtivo('REPROVANDO_FALTAS')}
                className={`text-left bg-white border rounded-xl p-4 transition-colors cursor-pointer ${
                  filtroAtivo === 'REPROVANDO_FALTAS'
                    ? 'border-rose-600 ring-1 ring-rose-600'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-semibold text-rose-700">
                  <span>Reprovando por Faltas</span>
                  <CalendarClock className="w-4 h-4" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-bold font-mono tabular-nums text-slate-900">
                    {turmaAtualObj.stats.reprovandoFaltasCount}
                  </span>
                  <span className="text-xs text-slate-500 font-mono tabular-nums">
                    de {turmaAtualObj.stats.totalAtivos} ativos
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1.5">
                  Média global anual oficial abaixo de 75% no Mapão
                </p>
              </button>

              {/* KPI 2: CRÍTICOS 4+ NOTAS VERMELHAS */}
              <button
                type="button"
                onClick={() => setFiltroAtivo('NOTAS_4_MAIS')}
                className={`text-left bg-white border rounded-xl p-4 transition-colors cursor-pointer ${
                  filtroAtivo === 'NOTAS_4_MAIS'
                    ? 'border-orange-600 ring-1 ring-orange-600'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-semibold text-orange-700">
                  <span>Críticos (4+ Vermelhas)</span>
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-bold font-mono tabular-nums text-slate-900">
                    {turmaAtualObj.stats.criticosNotas4MaisCount}
                  </span>
                  {turmaAtualObj.stats.duplosCriticosCount > 0 && (
                    <span className="text-xs font-semibold text-rose-700 font-mono tabular-nums">
                      ({turmaAtualObj.stats.duplosCriticosCount} duplo crítico)
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1.5">
                  Quatro ou mais componentes com nota abaixo de 5,0
                </p>
              </button>

              {/* KPI 3: FOCO AEE */}
              <button
                type="button"
                onClick={() => setFiltroAtivo('AEE')}
                className={`text-left bg-white border rounded-xl p-4 transition-colors cursor-pointer ${
                  filtroAtivo === 'AEE'
                    ? 'border-indigo-600 ring-1 ring-indigo-600'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-semibold text-indigo-700">
                  <span>Foco AEE na Turma</span>
                  <Accessibility className="w-4 h-4" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-bold font-mono tabular-nums text-slate-900">
                    {turmaAtualObj.stats.casosAEECount}
                  </span>
                  <span className="text-xs text-slate-500 font-mono tabular-nums">
                    {turmaAtualObj.stats.casosAEEComAlertaCount} com alerta
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1.5">
                  Cruzado com a base escolar (ajustável no detalhe)
                </p>
              </button>

              {/* KPI 4: PAUTA COMPLETA DO CONSELHO */}
              <button
                type="button"
                onClick={() => setFiltroAtivo('PAUTA')}
                className={`text-left bg-white border rounded-xl p-4 transition-colors cursor-pointer ${
                  filtroAtivo === 'PAUTA'
                    ? 'border-slate-900 ring-1 ring-slate-900'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                  <span>Conversar no Conselho</span>
                  <Users className="w-4 h-4" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-bold font-mono tabular-nums text-slate-900">
                    {turmaAtualObj.stats.pautaConselhoCount}
                  </span>
                  <span className="text-xs text-emerald-700 font-semibold font-mono tabular-nums">
                    {turmaAtualObj.stats.deliberadosCount} deliberados
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1.5">
                  Faltas &lt;75%, zona limite, 1+ vermelhas ou AEE
                </p>
              </button>
            </div>

            {/* BARRA DE CONTROLES: SEGMENTAÇÃO + BUSCA + FILTRO DISCIPLINA + ORDENAÇÃO */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-slate-200 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
                {/* Filtros Segmentados Interativos */}
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
                  {(
                    [
                      { key: 'PAUTA', label: 'Pauta do Conselho', count: turmaAtualObj.stats.pautaConselhoCount },
                      { key: 'REPROVANDO_FALTAS', label: 'Reprovando Faltas', count: turmaAtualObj.stats.reprovandoFaltasCount },
                      { key: 'NOTAS_4_MAIS', label: '4+ Vermelhas', count: turmaAtualObj.stats.criticosNotas4MaisCount },
                      { key: 'AEE', label: 'Casos AEE', count: turmaAtualObj.stats.casosAEECount },
                      { key: 'ATIVOS', label: 'Todos os Ativos', count: turmaAtualObj.stats.totalAtivos },
                      { key: 'TRANSFERIDOS', label: 'Transferidos', count: turmaAtualObj.stats.totalTransferidos }
                    ] as Array<{ key: FiltroConselho; label: string; count: number }>
                  ).map(tab => {
                    const active = filtroAtivo === tab.key;
                    return (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setFiltroAtivo(tab.key)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1.5 ${
                          active ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <span>{tab.label}</span>
                        <span className="font-mono tabular-nums text-[11px] text-slate-500">
                          {tab.count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Busca, Disciplina e Ordenação */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative flex-1 sm:w-56 sm:flex-none">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={buscaAluno}
                      onChange={e => setBuscaAluno(e.target.value)}
                      placeholder="Buscar estudante ou disciplina..."
                      className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400 text-slate-900"
                    />
                  </div>

                  {disciplinasComVermelhaNaTurma.length > 0 && (
                    <select
                      value={filtroDisciplinaVermelha}
                      onChange={e => setFiltroDisciplinaVermelha(e.target.value)}
                      className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-medium focus:outline-none focus:border-slate-400 cursor-pointer"
                    >
                      <option value="TODAS">Todas as disciplinas</option>
                      {disciplinasComVermelhaNaTurma.map(d => (
                        <option key={d.nome} value={d.nome}>
                          Vermelha em {d.curto} ({d.qtd})
                        </option>
                      ))}
                    </select>
                  )}

                  <select
                    value={ordenacao}
                    onChange={e => setOrdenacao(e.target.value as OrdenacaoConselho)}
                    className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-medium focus:outline-none focus:border-slate-400 cursor-pointer"
                  >
                    <option value="criticidade">Ordenar: Maior criticidade</option>
                    <option value="freq_asc">Ordenar: Menor freq. anual</option>
                    <option value="vermelhas_desc">Ordenar: Mais notas vermelhas</option>
                    <option value="chamada">Ordenar: Nº da chamada</option>
                    <option value="nome">Ordenar: Nome A–Z</option>
                  </select>
                </div>
              </div>

              {/* TABELA PRINCIPAL DE TRIAGEM DO CONSELHO */}
              {alunosExibidos.length === 0 ? (
                <div className="p-10 text-center space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
                  <h3 className="text-sm font-bold text-slate-900">
                    Nenhum estudante localizado neste filtro
                  </h3>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    {filtroAtivo === 'AEE'
                      ? 'Nenhum estudante desta turma está marcado como AEE na base. Você pode abrir "Todos os Ativos" e sinalizar AEE diretamente no detalhe de qualquer estudante.'
                      : filtroAtivo === 'NOTAS_4_MAIS'
                      ? 'Nenhum estudante ativo desta turma atingiu 4 ou mais notas vermelhas neste Mapão.'
                      : 'Ajuste os filtros acima ou selecione "Todos os Ativos" para visualizar a lista completa da turma.'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                        <th className="py-2.5 px-3 w-11 text-center">Nº</th>
                        <th className="py-2.5 px-3 min-w-[230px]">Estudante</th>
                        <th className="py-2.5 px-3 min-w-[185px]">Enquadramento no Conselho</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Global Anual</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Bimestre / AC</th>
                        <th className="py-2.5 px-3 min-w-[210px]">Notas Vermelhas (&lt; 5,0)</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Média</th>
                        <th className="py-2.5 px-3 min-w-[200px]">Deliberação</th>
                        <th className="py-2.5 px-3 text-right w-24">Mapão</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-sm">
                      {alunosExibidos.map(aluno => {
                        const rowBg =
                          aluno.duploCritico || aluno.reprovandoPorFaltasGlobal
                            ? 'bg-rose-50/40 hover:bg-rose-50/80'
                            : aluno.criticoNotas4Mais
                            ? 'bg-orange-50/40 hover:bg-orange-50/80'
                            : aluno.isAEE
                            ? 'bg-indigo-50/35 hover:bg-indigo-50/70'
                            : 'bg-white hover:bg-slate-50';

                        return (
                          <tr key={aluno.chaveAluno} className={`transition-colors ${rowBg}`}>
                            {/* Nº */}
                            <td className="py-3 px-3 text-center font-mono tabular-nums text-xs font-semibold text-slate-500">
                              {aluno.numChamada}
                            </td>

                            {/* ESTUDANTE */}
                            <td className="py-3 px-3">
                              <button
                                type="button"
                                onClick={() => setAlunoDetalheChave(aluno.chaveAluno)}
                                className="text-left group cursor-pointer"
                              >
                                <div className="font-semibold text-slate-900 group-hover:underline leading-snug">
                                  {aluno.nome}
                                </div>
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 mt-0.5">
                                  {aluno.isAEE && (
                                    <span className="font-bold text-indigo-700 inline-flex items-center gap-1">
                                      <Accessibility className="w-3 h-3" />
                                      AEE
                                    </span>
                                  )}
                                  {aluno.isAEE && (aluno.tutor || aluno.ra) && <span aria-hidden="true">·</span>}
                                  {aluno.tutor && <span>Tutor: {aluno.tutor}</span>}
                                  {!aluno.tutor && aluno.ra && <span className="font-mono tabular-nums">RA {aluno.ra}</span>}
                                  {aluno.recomposicao && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="text-slate-600 font-medium">Recomposição</span>
                                    </>
                                  )}
                                  {!aluno.isAtivo && (
                                    <span className="text-slate-500 font-medium">{aluno.situacao}</span>
                                  )}
                                </div>
                              </button>
                            </td>

                            {/* ENQUADRAMENTO SEMÂNTICO (TEXTO + ÍCONE, ZERO PILLS) */}
                            <td className="py-3 px-3">
                              <div className="space-y-0.5">
                                {aluno.duploCritico ? (
                                  <div className="text-xs font-bold text-rose-800 flex items-center gap-1.5">
                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                    <span>Crítico Duplo (Faltas + 4+ Verm.)</span>
                                  </div>
                                ) : aluno.reprovandoPorFaltasGlobal ? (
                                  <div className="text-xs font-bold text-rose-700 flex items-center gap-1.5">
                                    <CalendarClock className="w-3.5 h-3.5 shrink-0" />
                                    <span>
                                      {aluno.perdidoEmFaltasExtremo
                                        ? 'Perdido em Faltas (< 70%)'
                                        : 'Reprovando por Faltas (< 75%)'}
                                    </span>
                                  </div>
                                ) : aluno.criticoNotas4Mais ? (
                                  <div className="text-xs font-bold text-orange-700 flex items-center gap-1.5">
                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                    <span>Crítico: {aluno.qtdNotasVermelhas} notas vermelhas</span>
                                  </div>
                                ) : aluno.isAEE ? (
                                  <div className="text-xs font-bold text-indigo-700 flex items-center gap-1.5">
                                    <Accessibility className="w-3.5 h-3.5 shrink-0" />
                                    <span>Foco AEE — Pauta Obrigatória</span>
                                  </div>
                                ) : aluno.precisaConversaConselho ? (
                                  <div className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                    <span>
                                      {aluno.riscoLimiteFaltas
                                        ? 'Zona Limite de Faltas'
                                        : 'Atenção em Rendimento'}
                                    </span>
                                  </div>
                                ) : !aluno.isAtivo ? (
                                  <div className="text-xs font-medium text-slate-500">{aluno.situacao}</div>
                                ) : (
                                  <div className="text-xs font-medium text-emerald-700 flex items-center gap-1.5">
                                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                    <span>Situação Regular</span>
                                  </div>
                                )}

                                {aluno.reprovandoPorFaltasGlobal && aluno.aulasCompensacaoEstimadas > 0 && (
                                  <div className="text-[11px] text-rose-600 font-mono tabular-nums">
                                    Est. ~{aluno.aulasCompensacaoEstimadas} AC p/ atingir 75%
                                  </div>
                                )}
                                {!aluno.reprovandoPorFaltasGlobal && aluno.riscoLimiteFaltas && (
                                  <div className="text-[11px] text-amber-700">
                                    Risco de cair abaixo de 75%
                                  </div>
                                )}
                              </div>
                            </td>

                            {/* FREQUÊNCIA GLOBAL ANUAL */}
                            <td className="py-3 px-3 text-right font-mono tabular-nums">
                              <div
                                className={`text-sm font-bold ${
                                  aluno.reprovandoPorFaltasGlobal
                                    ? 'text-rose-700'
                                    : aluno.riscoLimiteFaltas
                                    ? 'text-amber-700'
                                    : 'text-slate-900'
                                }`}
                              >
                                {aluno.freqAnualStr}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {aluno.faltasTotalAno} faltas/ano
                              </div>
                            </td>

                            {/* BIMESTRE + REPOSIÇÕES (AC) */}
                            <td className="py-3 px-3 text-right font-mono tabular-nums">
                              <div
                                className={`text-xs font-semibold ${
                                  aluno.freqBimestreNum !== null && aluno.freqBimestreNum < 75
                                    ? 'text-rose-700'
                                    : 'text-slate-700'
                                }`}
                              >
                                {aluno.freqBimestreStr} · {aluno.totalFaltasBimestre}F
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {aluno.totalAusenciasCompensadas > 0
                                  ? `${aluno.totalAusenciasCompensadas} AC (repos.)`
                                  : '0 AC'}
                              </div>
                            </td>

                            {/* NOTAS VERMELHAS */}
                            <td className="py-3 px-3">
                              {aluno.qtdNotasVermelhas === 0 ? (
                                <span className="text-xs text-slate-400">Nenhuma</span>
                              ) : (
                                <div className="space-y-0.5">
                                  <div
                                    className={`text-xs font-bold font-mono tabular-nums ${
                                      aluno.criticoNotas4Mais ? 'text-orange-700' : 'text-rose-700'
                                    }`}
                                  >
                                    {aluno.qtdNotasVermelhas}{' '}
                                    {aluno.qtdNotasVermelhas === 1 ? 'disciplina' : 'disciplinas'}
                                  </div>
                                  <div className="text-xs text-slate-700 font-mono tabular-nums leading-snug">
                                    {aluno.notasVermelhas
                                      .slice(0, 4)
                                      .map(n => `${n.nomeCurto} ${n.mencao}`)
                                      .join(' · ')}
                                    {aluno.notasVermelhas.length > 4 &&
                                      ` +${aluno.notasVermelhas.length - 4}`}
                                  </div>
                                </div>
                              )}
                            </td>

                            {/* MÉDIA GLOBAL */}
                            <td className="py-3 px-3 text-right font-mono tabular-nums">
                              <span
                                className={`text-sm font-semibold ${
                                  aluno.mediaGlobalNotas !== null && aluno.mediaGlobalNotas < 5.5
                                    ? 'text-rose-700 font-bold'
                                    : 'text-slate-800'
                                }`}
                              >
                                {aluno.mediaGlobalNotas !== null ? aluno.mediaGlobalNotas.toFixed(1) : '—'}
                              </span>
                            </td>

                            {/* DELIBERAÇÃO INLINE */}
                            <td className="py-3 px-3">
                              {aluno.isAtivo ? (
                                <div className="space-y-1">
                                  <select
                                    value={aluno.deliberacao.status}
                                    onChange={e =>
                                      salvarDeliberacaoAluno(
                                        turmaAtualObj.doc.chaveTurmaBimestre,
                                        aluno.chaveAluno,
                                        { status: e.target.value as StatusDeliberacaoConselho },
                                        true
                                      )
                                    }
                                    className={`w-full px-2 py-1 text-xs rounded-md border font-medium cursor-pointer focus:outline-none ${
                                      aluno.deliberacao.status === 'PENDENTE'
                                        ? 'bg-white border-slate-200 text-slate-600'
                                        : aluno.deliberacao.status === 'RETENCAO_PREVISTA'
                                        ? 'bg-rose-50 border-rose-300 text-rose-800'
                                        : 'bg-emerald-50 border-emerald-300 text-emerald-900'
                                    }`}
                                  >
                                    {(Object.keys(DELIBERACAO_LABELS) as StatusDeliberacaoConselho[]).map(k => (
                                      <option key={k} value={k}>
                                        {DELIBERACAO_LABELS[k]}
                                      </option>
                                    ))}
                                  </select>
                                  {aluno.deliberacao.parecer && (
                                    <p className="text-[11px] text-slate-500 truncate max-w-[200px]" title={aluno.deliberacao.parecer}>
                                      {aluno.deliberacao.parecer}
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-slate-400">—</span>
                              )}
                            </td>

                            {/* AÇÃO VER DETALHE */}
                            <td className="py-3 px-3 text-right">
                              <button
                                type="button"
                                onClick={() => setAlunoDetalheChave(aluno.chaveAluno)}
                                className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-400 rounded-md transition-colors inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>Ver</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* SÍNTESE CONFIDENCIAL DA TURMA (ENCAMINHAMENTOS GERAIS DO CONSELHO) */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Síntese e Encaminhamentos Gerais da Turma ({turmaAtualObj.doc.metadata.turmaNormalizada})
                  </h3>
                  <p className="text-xs text-slate-500">
                    Registro confidencial da Direção, Vice-Direção e CGPG. Incluído automaticamente na Pauta PDF.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={salvandoObsTurma}
                  onClick={salvarObservacoesTurma}
                  className="px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap self-start sm:self-auto cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{salvandoObsTurma ? 'Salvando...' : 'Salvar Síntese'}</span>
                </button>
              </div>
              <textarea
                rows={3}
                value={obsTurmaDraft}
                onChange={e => setObsTurmaDraft(e.target.value)}
                placeholder="Ex: Priorizar convocação das famílias dos 3 alunos abaixo de 75% anual para plano de compensação de ausências; acompanhar casos AEE junto à sala de recursos..."
                className="w-full p-3 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-slate-400 resize-y"
              />
            </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* DRAWER / MODAL DE DETALHE COMPLETO DO ESTUDANTE NO MAPÃO     */}
      {/* ============================================================ */}
      {alunoDetalhe && turmaAtualObj && (
        <div
          className="fixed inset-0 z-[100] bg-slate-950/50 flex justify-end"
          onClick={() => setAlunoDetalheChave(null)}
        >
          <div
            className="w-full max-w-3xl bg-white h-full overflow-y-auto shadow-2xl border-l border-slate-200 flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Topo do Drawer */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4 sticky top-0 bg-white z-10">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-medium">
                  <span className="font-mono tabular-nums">Nº {alunoDetalhe.numChamada}</span>
                  <span aria-hidden="true">·</span>
                  <span>{turmaAtualObj.doc.metadata.turmaNormalizada}</span>
                  <span aria-hidden="true">·</span>
                  <span>{turmaAtualObj.doc.metadata.tipoFechamento}</span>
                  {alunoDetalhe.ra && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">RA {alunoDetalhe.ra}</span>
                    </>
                  )}
                </div>
                <h3 className="text-lg font-bold text-slate-900 mt-1">{alunoDetalhe.nome}</h3>
                {alunoDetalhe.tutor && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    Tutoria PEI: <span className="font-semibold text-slate-700">{alunoDetalhe.tutor}</span>
                    {alunoDetalhe.telefoneResponsavel ? ` · Contato: ${alunoDetalhe.telefoneResponsavel}` : ''}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {alunoDetalhe.ra && (
                  <button
                    type="button"
                    onClick={() => abrirFichaAlunoNaEscola(alunoDetalhe.ra)}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Ficha Completa</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setAlunoDetalheChave(null)}
                  className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer"
                  aria-label="Fechar detalhes"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6 flex-1">
              {/* Resumo Numérico do Estudante */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="text-[11px] font-semibold text-slate-500">Global Anual</div>
                  <div
                    className={`text-xl font-bold font-mono tabular-nums mt-0.5 ${
                      alunoDetalhe.reprovandoPorFaltasGlobal ? 'text-rose-700' : 'text-slate-900'
                    }`}
                  >
                    {alunoDetalhe.freqAnualStr}
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                    {alunoDetalhe.faltasTotalAno} faltas no ano
                  </div>
                </div>

                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="text-[11px] font-semibold text-slate-500">Bimestre Oficial</div>
                  <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                    {alunoDetalhe.freqBimestreStr}
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                    {alunoDetalhe.totalFaltasBimestre} F · {alunoDetalhe.totalAusenciasCompensadas} AC
                  </div>
                </div>

                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="text-[11px] font-semibold text-slate-500">Notas Vermelhas</div>
                  <div
                    className={`text-xl font-bold font-mono tabular-nums mt-0.5 ${
                      alunoDetalhe.criticoNotas4Mais
                        ? 'text-orange-700'
                        : alunoDetalhe.qtdNotasVermelhas > 0
                        ? 'text-rose-700'
                        : 'text-emerald-700'
                    }`}
                  >
                    {alunoDetalhe.qtdNotasVermelhas}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Média {alunoDetalhe.mediaGlobalNotas !== null ? alunoDetalhe.mediaGlobalNotas.toFixed(1) : '—'}
                  </div>
                </div>

                {/* Controle AEE Direto no Conselho */}
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg flex flex-col justify-between">
                  <div className="text-[11px] font-semibold text-slate-500">Educação Especial</div>
                  <button
                    type="button"
                    onClick={() =>
                      salvarDeliberacaoAluno(
                        turmaAtualObj.doc.chaveTurmaBimestre,
                        alunoDetalhe.chaveAluno,
                        { aeeManual: !alunoDetalhe.isAEE }
                      )
                    }
                    className={`mt-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                      alunoDetalhe.isAEE
                        ? 'bg-indigo-700 text-white hover:bg-indigo-800'
                        : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    <Accessibility className="w-3.5 h-3.5" />
                    <span>{alunoDetalhe.isAEE ? 'AEE Ativo' : 'Marcar AEE'}</span>
                  </button>
                </div>
              </div>

              {/* Motivos Objetivos da Pauta no Conselho */}
              {alunoDetalhe.motivosConselho.length > 0 && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                  <h4 className="text-xs font-bold text-slate-900">
                    Pontos para Discussão no Conselho
                  </h4>
                  <ul className="space-y-1.5 text-xs text-slate-700">
                    {alunoDetalhe.motivosConselho.map((m, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="font-mono text-slate-400 select-none">•</span>
                        <span>{m}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Histórico de Boletins dos Bimestres Anteriores (1º ao 4º Bim / Final) */}
              {alunoDetalhe.boletimHistorico && alunoDetalhe.boletimHistorico.length > 0 && (
                <div className="p-4 bg-white border border-slate-200 rounded-lg space-y-2.5">
                  <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5 text-slate-600" />
                    <span>Evolução nos Boletins Já Lançados no Sistema</span>
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                          <th className="py-1.5 px-2.5">Bimestre</th>
                          <th className="py-1.5 px-2.5 text-right">Média Geral</th>
                          <th className="py-1.5 px-2.5 text-right">Freq. Bim.</th>
                          <th className="py-1.5 px-2.5 text-right">Freq. Anual</th>
                          <th className="py-1.5 px-2.5 text-right">Faltas Bim.</th>
                          <th className="py-1.5 px-2.5 text-right">Vermelhas</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                        {alunoDetalhe.boletimHistorico.map(bh => (
                          <tr key={bh.bimestreKey} className="hover:bg-slate-50">
                            <td className="py-1.5 px-2.5 font-sans font-semibold text-slate-800">{bh.label}</td>
                            <td className="py-1.5 px-2.5 text-right font-semibold text-slate-900">
                              {bh.mediaGeral !== null ? bh.mediaGeral.toFixed(1) : '—'}
                            </td>
                            <td className="py-1.5 px-2.5 text-right text-slate-700">{bh.freqBimestreStr}</td>
                            <td className="py-1.5 px-2.5 text-right font-semibold text-slate-800">{bh.freqAnualStr}</td>
                            <td className="py-1.5 px-2.5 text-right text-slate-600">{bh.totalFaltasBimestre}</td>
                            <td
                              className={`py-1.5 px-2.5 text-right font-bold ${
                                bh.qtdNotasVermelhas >= 4
                                  ? 'text-orange-700'
                                  : bh.qtdNotasVermelhas > 0
                                  ? 'text-rose-700'
                                  : 'text-emerald-700'
                              }`}
                            >
                              {bh.qtdNotasVermelhas}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Deliberação, (Resultado Final apenas no Final) e Parecer Confidencial */}
              {alunoDetalhe.isAtivo && (
                <div className="p-4 bg-white border border-slate-200 rounded-lg space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-bold text-slate-900">
                      {turmaAtualObj.doc.metadata.bimestreKey === 'FINAL'
                        ? 'Deliberação, Resultado Final e Parecer para o Dossiê'
                        : 'Deliberação e Parecer Confidencial do Conselho'}
                    </h4>
                    {alunoDetalhe.deliberacao.atualizadoPor && (
                      <span className="text-[11px] text-slate-500">
                        Última edição: {alunoDetalhe.deliberacao.atualizadoPor}
                      </span>
                    )}
                  </div>

                  {turmaAtualObj.doc.metadata.bimestreKey === 'FINAL' ? (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1">
                            Encaminhamento Oficial
                          </label>
                          <select
                            value={statusDraft}
                            onChange={e => setStatusDraft(e.target.value as StatusDeliberacaoConselho)}
                            className="w-full px-3 py-2 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-slate-400 cursor-pointer"
                          >
                            {(Object.keys(DELIBERACAO_LABELS) as StatusDeliberacaoConselho[]).map(k => (
                              <option key={k} value={k}>
                                {DELIBERACAO_LABELS[k]}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1">
                            Resultado Final (Aprovação / Retenção)
                          </label>
                          <select
                            value={resultadoFinalDraft}
                            onChange={e => {
                              const novo = e.target.value as ResultadoFinalConselho;
                              setResultadoFinalDraft(novo);
                              const sug = sugerirTurmasAnoSeguinte(turmaAtualObj.doc.metadata.turmaNormalizada, novo);
                              setTurmaSeguinteDraft(sug.sugestaoPrincipal);
                            }}
                            className="w-full px-3 py-2 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-slate-400 cursor-pointer"
                          >
                            {(Object.keys(RESULTADO_FINAL_LABELS) as ResultadoFinalConselho[]).map(k => (
                              <option key={k} value={k}>
                                {RESULTADO_FINAL_LABELS[k]}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1">
                            Turma no Ano Seguinte ({anoLetivo + 1})
                          </label>
                          <input
                            type="text"
                            list="opcoes-turma-seguinte-drawer"
                            value={turmaSeguinteDraft}
                            onChange={e => setTurmaSeguinteDraft(e.target.value)}
                            placeholder={`Ex: ${sugerirTurmasAnoSeguinte(turmaAtualObj.doc.metadata.turmaNormalizada, resultadoFinalDraft).sugestaoPrincipal}`}
                            className="w-full px-3 py-2 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-slate-400"
                          />
                          <datalist id="opcoes-turma-seguinte-drawer">
                            {sugerirTurmasAnoSeguinte(
                              turmaAtualObj.doc.metadata.turmaNormalizada,
                              resultadoFinalDraft
                            ).opcoes.map(op => (
                              <option key={op} value={op} />
                            ))}
                          </datalist>
                        </div>
                        <div className="flex items-end">
                          <button
                            type="button"
                            disabled={salvandoDeliberacao}
                            onClick={() =>
                              salvarDeliberacaoAluno(turmaAtualObj.doc.chaveTurmaBimestre, alunoDetalhe.chaveAluno, {
                                status: statusDraft,
                                parecer: parecerDraft,
                                resultadoFinal: resultadoFinalDraft,
                                turmaAnoSeguinte: turmaSeguinteDraft.trim()
                              })
                            }
                            className="w-full sm:w-auto px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            {salvandoDeliberacao ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Check className="w-3.5 h-3.5" />
                            )}
                            <span>{salvandoDeliberacao ? 'Salvando...' : 'Salvar Parecer no Conselho e Dossiê'}</span>
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">
                          Encaminhamento Oficial
                        </label>
                        <select
                          value={statusDraft}
                          onChange={e => setStatusDraft(e.target.value as StatusDeliberacaoConselho)}
                          className="w-full px-3 py-2 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-slate-400 cursor-pointer"
                        >
                          {(Object.keys(DELIBERACAO_LABELS) as StatusDeliberacaoConselho[]).map(k => (
                            <option key={k} value={k}>
                              {DELIBERACAO_LABELS[k]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-end">
                        <button
                          type="button"
                          disabled={salvandoDeliberacao}
                          onClick={() =>
                            salvarDeliberacaoAluno(turmaAtualObj.doc.chaveTurmaBimestre, alunoDetalhe.chaveAluno, {
                              status: statusDraft,
                              parecer: parecerDraft
                            })
                          }
                          className="w-full sm:w-auto px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          {salvandoDeliberacao ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Check className="w-3.5 h-3.5" />
                          )}
                          <span>{salvandoDeliberacao ? 'Salvando...' : 'Salvar Parecer'}</span>
                        </button>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      {turmaAtualObj.doc.metadata.bimestreKey === 'FINAL'
                        ? `Parecer Individual do Conselho Final (gravado no Dossiê para consulta em ${anoLetivo + 1})`
                        : 'Ata / Anotação do Conselho (Direção, Vice e CGPG)'}
                    </label>
                    <textarea
                      rows={3}
                      value={parecerDraft}
                      onChange={e => setParecerDraft(e.target.value)}
                      placeholder={
                        turmaAtualObj.doc.metadata.bimestreKey === 'FINAL'
                          ? `Descreva os pontos pedagógicos, de frequência e recomendações para ${anoLetivo + 1} (ex: atenção em Matemática, acompanhamento AEE, tutoria sugerida)...`
                          : 'Registre o acordo do conselho, plano de compensação de ausências, adaptação AEE ou encaminhamento para família/Conselho Tutelar...'
                      }
                      className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-slate-400 resize-y"
                    />
                  </div>
                </div>
              )}

              {/* Grade Completa do Mapão por Componente Curricular */}
              <div className="space-y-2.5">
                <h4 className="text-sm font-bold text-slate-900">
                  Boletim Oficial do Mapão por Componente Curricular
                </h4>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                        <th className="py-2 px-3">Componente Curricular</th>
                        <th className="py-2 px-2.5 text-right">Aulas</th>
                        <th className="py-2 px-2.5 text-right">Nota (M)</th>
                        <th className="py-2 px-2.5 text-right">Faltas (F)</th>
                        <th className="py-2 px-2.5 text-right">Repos. (AC)</th>
                        <th className="py-2 px-3 text-right">Freq. Disc.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {Object.values(alunoDetalhe.disciplinas).map(disc => {
                        const faltasLiq = Math.max(0, disc.faltas - disc.ausenciaCompensada);
                        const pctDisc =
                          disc.aulasDadas && disc.aulasDadas > 0
                            ? Math.max(0, Math.min(100, Math.round(((disc.aulasDadas - faltasLiq) / disc.aulasDadas) * 100)))
                            : null;
                        const faltaAlta = pctDisc !== null && pctDisc < 75;
                        return (
                          <tr
                            key={disc.codigo + disc.nome}
                            className={disc.notaVermelha ? 'bg-rose-50/50' : 'bg-white'}
                          >
                            <td className="py-2 px-3 font-medium text-slate-800">
                              <span>{disc.nome}</span>
                              <span className="ml-1.5 text-[10px] font-mono text-slate-400">
                                {disc.codigo}
                              </span>
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-500">
                              {disc.aulasDadas ?? '—'}
                            </td>
                            <td
                              className={`py-2 px-2.5 text-right font-mono tabular-nums font-bold ${
                                disc.notaVermelha ? 'text-rose-700' : 'text-slate-900'
                              }`}
                            >
                              {disc.mencao}
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-700">
                              {disc.faltas}
                            </td>
                            <td
                              className={`py-2 px-2.5 text-right font-mono tabular-nums ${
                                disc.ausenciaCompensada > 0 ? 'text-emerald-700 font-semibold' : 'text-slate-400'
                              }`}
                            >
                              {disc.ausenciaCompensada}
                            </td>
                            <td
                              className={`py-2 px-3 text-right font-mono tabular-nums font-semibold ${
                                faltaAlta ? 'text-rose-700' : 'text-slate-700'
                              }`}
                            >
                              {pctDisc !== null ? `${pctDisc}%` : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
