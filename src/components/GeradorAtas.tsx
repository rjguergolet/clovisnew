import React, { useState, useEffect, useMemo } from 'react';
import { db, collection, getDocs, deleteDoc, doc } from '../lib/database';
import { gerarLivroAtaPdf, imprimirLivroAta, AtaExportData } from '../utils/ataPdfExport';

interface EstudanteItem {
  id: string;
  ra: string;
  nome: string;
  turma: string;
  status: string;
  acoes_2026?: string;
}

interface FuncionarioItem {
  id: string;
  nome: string;
  email: string;
  cargo: string;
  disciplina?: string;
  acoes_2026?: string;
}

interface AtaSalva extends AtaExportData {
  id: string;
  anotacaoDossie?: string;
  notasBrutas?: string;
  autorCargo?: string;
  criadoEm?: string;
}

const TIPOS_ATA = [
  'Atendimento Individual',
  'Reunião de Grêmio',
  'Alinhamento Geral',
  'Reunião de Pais/Mestres',
  'Conselho de Classe',
  'Outros'
] as const;

function obterDataAtualISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function obterHorarioAtual(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function normalizarTextoBusca(str: string): string {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function formatarDataBR(iso?: string, dataBR?: string): string {
  if (dataBR && /\d{2}\/\d{2}\/\d{4}/.test(dataBR)) return dataBR;
  if (iso && /^\d{4}-\d{2}-\d{2}/.test(iso)) {
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
  return new Date().toLocaleDateString('pt-BR');
}

function obterAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof localStorage !== 'undefined') {
    const token = localStorage.getItem('clovis_auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export default function GeradorAtas() {
  const [subAba, setSubAba] = useState<'nova' | 'historico'>('nova');

  // Bases carregadas
  const [alunosBase, setAlunosBase] = useState<EstudanteItem[]>([]);
  const [funcionariosBase, setFuncionariosBase] = useState<FuncionarioItem[]>([]);
  const [atasSalvas, setAtasSalvas] = useState<AtaSalva[]>([]);
  const [carregandoBases, setCarregandoBases] = useState(true);

  // Campos do formulário
  const [tipoAta, setTipoAta] = useState<string>('Atendimento Individual');
  const [dataAta, setDataAta] = useState<string>(obterDataAtualISO);
  const [horarioAta, setHorarioAta] = useState<string>(obterHorarioAtual);
  const [estudantesSelecionados, setEstudantesSelecionados] = useState<EstudanteItem[]>([]);
  const [funcionariosSelecionados, setFuncionariosSelecionados] = useState<FuncionarioItem[]>([]);
  const [outrosParticipantes, setOutrosParticipantes] = useState<string>('');
  const [notasBrutas, setNotasBrutas] = useState<string>('');

  // Buscas dos seletores múltiplos
  const [buscaEstudante, setBuscaEstudante] = useState<string>('');
  const [buscaFuncionario, setBuscaFuncionario] = useState<string>('');

  // Texto estruturado (plain text) & estados operacionais
  const [textoAta, setTextoAta] = useState<string>('');
  const [resumoDossie, setResumoDossie] = useState<string>('');
  const [estruturandoIA, setEstruturandoIA] = useState<boolean>(false);
  const [salvandoAta, setSalvandoAta] = useState<boolean>(false);
  const [exportandoPdf, setExportandoPdf] = useState<boolean>(false);
  const [copiado, setCopiado] = useState<boolean>(false);
  const [erroMensagem, setErroMensagem] = useState<string | null>(null);
  const [sucessoInfo, setSucessoInfo] = useState<{
    anotacaoCurta: string;
    qtdAlunos: number;
    qtdFuncionarios: number;
  } | null>(null);

  // Filtros do histórico
  const [filtroTipoHist, setFiltroTipoHist] = useState<string>('TODOS');
  const [buscaHist, setBuscaHist] = useState<string>('');
  const [confirmandoExclusaoId, setConfirmandoExclusaoId] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;

    const carregarDados = async () => {
      setCarregandoBases(true);
      try {
        // 1. Alunos (aproveita cache global + consulta ao banco)
        let listaAlunosRaw: any[] = Array.isArray((window as any).allStudentsData)
          ? (window as any).allStudentsData
          : [];

        if (listaAlunosRaw.length === 0) {
          try {
            const snapAlunos = await getDocs(collection(db, 'alunos'));
            listaAlunosRaw = snapAlunos.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
          } catch {}
        }

        const alunosMap = new Map<string, EstudanteItem>();
        listaAlunosRaw.forEach((a: any) => {
          const ra = String(a?.ra || '').trim();
          const nome = String(a?.nome || '').trim();
          if (!nome) return;
          const chave = ra || String(a?.id || nome);
          if (!alunosMap.has(chave)) {
            alunosMap.set(chave, {
              id: String(a?.id || chave),
              ra,
              nome,
              turma: String(a?.turma || '').trim(),
              status: String(a?.status || 'ATIVO').toUpperCase(),
              acoes_2026: String(a?.acoes_2026 || '')
            });
          }
        });

        const alunosOrdenados = Array.from(alunosMap.values()).sort((a, b) =>
          a.nome.localeCompare(b.nome, 'pt-BR')
        );

        // 2. Funcionários (deduplicados por e-mail / nome normalizado)
        let listaUsuariosRaw: any[] = Array.isArray((window as any).usuariosCache)
          ? (window as any).usuariosCache
          : [];
        if (listaUsuariosRaw.length === 0) {
          try {
            const snapUsers = await getDocs(collection(db, 'usuarios'));
            listaUsuariosRaw = snapUsers.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
            if (typeof window !== 'undefined') {
              (window as any).usuariosCache = listaUsuariosRaw;
            }
          } catch {}
        }

        const funcsMap = new Map<string, FuncionarioItem>();
        listaUsuariosRaw.forEach((u: any) => {
          const nome = String(u?.nome || '').trim();
          if (!nome) return;
          const email = String(u?.email || '').trim().toLowerCase();
          const chave = email || normalizarTextoBusca(nome);
          if (!funcsMap.has(chave)) {
            funcsMap.set(chave, {
              id: String(u?.id || chave),
              nome,
              email,
              cargo: String(u?.cargo || u?.role || 'Equipe Escolar').trim(),
              disciplina: String(u?.disciplina || '').trim(),
              acoes_2026: String(u?.acoes_2026 || '')
            });
          }
        });

        const funcsOrdenados = Array.from(funcsMap.values()).sort((a, b) =>
          a.nome.localeCompare(b.nome, 'pt-BR')
        );

        // 3. Atas registradas
        let atasRaw: AtaSalva[] = [];
        try {
          const snapAtas = await getDocs(collection(db, 'atas_escolares'));
          atasRaw = snapAtas.docs
            .map(d => ({ id: d.id, ...(d.data() as any) }))
            .sort((a: any, b: any) => {
              const da = String(a?.criadoEm || a?.dataAta || '');
              const dbStr = String(b?.criadoEm || b?.dataAta || '');
              return dbStr.localeCompare(da);
            });
        } catch {}

        if (ativo) {
          setAlunosBase(alunosOrdenados);
          setFuncionariosBase(funcsOrdenados);
          setAtasSalvas(atasRaw);
        }
      } finally {
        if (ativo) setCarregandoBases(false);
      }
    };

    carregarDados();
    return () => {
      ativo = false;
    };
  }, []);

  const alunosFiltrados = useMemo(() => {
    const q = normalizarTextoBusca(buscaEstudante);
    const selecionadosSet = new Set(estudantesSelecionados.map(e => e.ra || e.id));
    const list = q
      ? alunosBase.filter(a => {
          const alvo = normalizarTextoBusca(`${a.nome} ${a.ra} ${a.turma}`);
          return alvo.includes(q);
        })
      : alunosBase;
    // Prioriza ativos na exibição padrão e limita para performance da lista
    return [...list]
      .sort((a, b) => {
        const aSel = selecionadosSet.has(a.ra || a.id) ? 0 : 1;
        const bSel = selecionadosSet.has(b.ra || b.id) ? 0 : 1;
        if (aSel !== bSel) return aSel - bSel;
        const aAtivo = a.status === 'ATIVO' ? 0 : 1;
        const bAtivo = b.status === 'ATIVO' ? 0 : 1;
        if (aAtivo !== bAtivo) return aAtivo - bAtivo;
        return a.nome.localeCompare(b.nome, 'pt-BR');
      })
      .slice(0, 80);
  }, [alunosBase, buscaEstudante, estudantesSelecionados]);

  const funcionariosFiltrados = useMemo(() => {
    const q = normalizarTextoBusca(buscaFuncionario);
    const selecionadosSet = new Set(funcionariosSelecionados.map(f => f.email || f.id));
    const list = q
      ? funcionariosBase.filter(f => {
          const alvo = normalizarTextoBusca(`${f.nome} ${f.cargo} ${f.disciplina || ''} ${f.email}`);
          return alvo.includes(q);
        })
      : funcionariosBase;
    return [...list].sort((a, b) => {
      const aSel = selecionadosSet.has(a.email || a.id) ? 0 : 1;
      const bSel = selecionadosSet.has(b.email || b.id) ? 0 : 1;
      if (aSel !== bSel) return aSel - bSel;
      return a.nome.localeCompare(b.nome, 'pt-BR');
    });
  }, [funcionariosBase, buscaFuncionario, funcionariosSelecionados]);

  const toggleEstudante = (est: EstudanteItem) => {
    const key = est.ra || est.id;
    setEstudantesSelecionados(prev => {
      const existe = prev.some(item => (item.ra || item.id) === key);
      return existe ? prev.filter(item => (item.ra || item.id) !== key) : [...prev, est];
    });
  };

  const toggleFuncionario = (func: FuncionarioItem) => {
    const key = func.email || func.id;
    setFuncionariosSelecionados(prev => {
      const existe = prev.some(item => (item.email || item.id) === key);
      return existe ? prev.filter(item => (item.email || item.id) !== key) : [...prev, func];
    });
  };

  const handleEstruturarComIA = async () => {
    setErroMensagem(null);
    setSucessoInfo(null);

    if (!notasBrutas.trim()) {
      setErroMensagem('Informe os pontos principais no campo Notas Brutas antes de estruturar a ata com IA.');
      return;
    }

    setEstruturandoIA(true);
    try {
      const headers = {
        ...obterAuthHeaders(),
        Accept: 'text/event-stream'
      };
      const res = await fetch('/api/ai/estruturar-ata', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tipoAta,
          dataAta,
          horarioAta,
          estudantes: estudantesSelecionados.map(e => ({
            ra: e.ra,
            nome: e.nome,
            turma: e.turma
          })),
          funcionarios: funcionariosSelecionados.map(f => ({
            nome: f.nome,
            cargo: f.cargo
          })),
          outrosParticipantes,
          notasBrutas,
          stream: true
        })
      });

      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('text/event-stream') || !res.body) {
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(payload?.error || payload?.details || `Erro HTTP ${res.status}`);
        }
        const textoEstruturado = String(payload?.textoAta || '').trim();
        if (!textoEstruturado) {
          throw new Error('A resposta da IA veio vazia. Tente detalhar melhor as notas brutas.');
        }
        setTextoAta(textoEstruturado);
        if (payload?.resumoDossie) {
          setResumoDossie(String(payload.resumoDossie));
        }
        if (typeof (window as any).showToast === 'function') {
          (window as any).showToast('Ata formal estruturada com sucesso em texto simples.', 'success');
        }
        return;
      }

      setTextoAta('');
      setResumoDossie('');
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let acumulado = '';
      let finalRecebido = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const ev of events) {
          const line = ev
            .split('\n')
            .find(l => l.startsWith('data: '));
          if (!line) continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.error) {
              throw new Error(parsed.error);
            }
            if (parsed.chunk) {
              acumulado += parsed.chunk;
              setTextoAta(acumulado);
            }
            if (parsed.done && parsed.textoAta) {
              finalRecebido = true;
              setTextoAta(String(parsed.textoAta));
              if (parsed.resumoDossie) {
                setResumoDossie(String(parsed.resumoDossie));
              }
            }
          } catch (parseErr: any) {
            if (parseErr instanceof Error && !parseErr.message.includes('JSON')) {
              throw parseErr;
            }
          }
        }
      }

      if (!finalRecebido && !acumulado.trim()) {
        throw new Error('A resposta da IA veio vazia. Tente detalhar melhor as notas brutas.');
      }

      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Ata formal estruturada com sucesso em texto simples.', 'success');
      }
    } catch (err: any) {
      setErroMensagem(err?.message || 'Não foi possível estruturar a ata com a IA.');
    } finally {
      setEstruturandoIA(false);
    }
  };

  const handleSalvarEIntegrar = async () => {
    setErroMensagem(null);
    setSucessoInfo(null);

    if (!textoAta.trim()) {
      setErroMensagem('Gere ou redija o texto final da ata antes de salvar e integrar aos dossiês.');
      return;
    }

    setSalvandoAta(true);
    try {
      const res = await fetch('/api/atas/salvar', {
        method: 'POST',
        headers: obterAuthHeaders(),
        body: JSON.stringify({
          tipoAta,
          dataAta,
          horarioAta,
          estudantes: estudantesSelecionados.map(e => ({
            id: e.id,
            ra: e.ra,
            nome: e.nome,
            turma: e.turma
          })),
          funcionarios: funcionariosSelecionados.map(f => ({
            id: f.id,
            email: f.email,
            nome: f.nome,
            cargo: f.cargo
          })),
          outrosParticipantes,
          notasBrutas,
          textoAta,
          resumoDossie
        })
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || `Erro HTTP ${res.status} ao salvar ata`);
      }

      // Sincroniza cache local de alunos (acoes_2026 + ocorrencias) e ocorrências globais para refletir imediatamente nos dossiês
      const alunosAtualizados: Array<{ ra: string; acoes_2026: string; novaOcorrencia?: any }> =
        payload?.alunosAtualizados || [];
      const ocorrenciasCriadas: any[] = Array.isArray(payload?.ocorrenciasCriadas)
        ? payload.ocorrenciasCriadas
        : [];

      if (ocorrenciasCriadas.length > 0 && typeof window !== 'undefined') {
        const adicionarSemDuplicar = (atual: any[]) => {
          const base = Array.isArray(atual) ? [...atual] : [];
          const ids = new Set(base.map(item => String(item?.id || '')));
          ocorrenciasCriadas.forEach(oc => {
            if (!oc?.id || !ids.has(String(oc.id))) {
              base.unshift(oc);
            }
          });
          return base;
        };
        (window as any).ocorrenciasCache = adicionarSemDuplicar((window as any).ocorrenciasCache);
        (window as any).ocorrenciasTopLevel = adicionarSemDuplicar((window as any).ocorrenciasTopLevel);
        if ((window as any).smartCache) {
          (window as any).smartCache.set('ocorrencias_cache', (window as any).ocorrenciasCache);
        }
      }

      if (alunosAtualizados.length > 0 && typeof window !== 'undefined') {
        const mapaAtual = new Map(alunosAtualizados.map(item => [String(item.ra), item]));
        if (Array.isArray((window as any).allStudentsData)) {
          (window as any).allStudentsData = (window as any).allStudentsData.map((al: any) => {
            const raKey = String(al?.ra || '');
            const upd = mapaAtual.get(raKey);
            if (!upd) return al;
            const ocsAtuais = Array.isArray(al?.ocorrencias) ? al.ocorrencias : [];
            return {
              ...al,
              acoes_2026: upd.acoes_2026,
              ocorrencias: upd.novaOcorrencia ? [upd.novaOcorrencia, ...ocsAtuais] : ocsAtuais
            };
          });
        }
        if ((window as any).smartCache && Array.isArray((window as any).allStudentsData)) {
          (window as any).smartCache.set('alunos_cache', (window as any).allStudentsData);
        }
        setAlunosBase(prev =>
          prev.map(al => {
            const upd = mapaAtual.get(al.ra);
            return upd ? { ...al, acoes_2026: upd.acoes_2026 } : al;
          })
        );
      }

      // Se houver modal de dossiê aberto no momento para um dos estudantes, atualiza na hora
      if (
        typeof window !== 'undefined' &&
        (window as any).currentDossieRa &&
        typeof (window as any).carregarHistoricoAcoesModal === 'function'
      ) {
        const raAberto = String((window as any).currentDossieRa);
        if (alunosAtualizados.some(a => String(a.ra) === raAberto)) {
          (window as any).carregarHistoricoAcoesModal(raAberto);
        }
      }

      // Sincroniza cache local de funcionários (acoes_2026)
      const funcsAtualizados: Array<{ id?: string; email?: string; acoes_2026: string }> =
        payload?.funcionariosAtualizados || [];
      if (funcsAtualizados.length > 0 && typeof window !== 'undefined') {
        const mapaFuncEmail = new Map(
          funcsAtualizados.filter(f => f.email).map(f => [String(f.email).toLowerCase(), f.acoes_2026])
        );
        const mapaFuncId = new Map(
          funcsAtualizados.filter(f => f.id).map(f => [String(f.id), f.acoes_2026])
        );
        if (Array.isArray((window as any).usuariosCache)) {
          (window as any).usuariosCache = (window as any).usuariosCache.map((u: any) => {
            const em = String(u?.email || '').toLowerCase();
            const uid = String(u?.id || '');
            if (em && mapaFuncEmail.has(em)) return { ...u, acoes_2026: mapaFuncEmail.get(em) };
            if (uid && mapaFuncId.has(uid)) return { ...u, acoes_2026: mapaFuncId.get(uid) };
            return u;
          });
        }
      }

      if (payload?.ata) {
        setAtasSalvas(prev => [payload.ata, ...prev]);
      }

      if (payload?.resumoDossie && !resumoDossie.trim()) {
        setResumoDossie(String(payload.resumoDossie));
      }

      const info = {
        anotacaoCurta: String(payload?.anotacaoCurta || `[${formatarDataBR(dataAta)}] - Ata de ${tipoAta} registrada`),
        qtdAlunos: alunosAtualizados.length,
        qtdFuncionarios: funcsAtualizados.length
      };
      setSucessoInfo(info);

      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Ata salva e resumo registrado no dossiê dos envolvidos.', 'success');
      }
    } catch (err: any) {
      setErroMensagem(err?.message || 'Falha ao salvar ata no banco de dados.');
    } finally {
      setSalvandoAta(false);
    }
  };

  const handleCopiarTexto = async (conteudo?: string) => {
    const alvo = (conteudo ?? textoAta).trim();
    if (!alvo) return;
    try {
      await navigator.clipboard.writeText(alvo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2200);
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Texto simples da ata copiado para a área de transferência.', 'success');
      }
    } catch {
      setErroMensagem('Não foi possível acessar a área de transferência do navegador.');
    }
  };

  const buildExportPayload = (ataItem?: AtaSalva): AtaExportData => {
    if (ataItem) return ataItem;
    return {
      tipoAta,
      dataAta,
      dataBR: formatarDataBR(dataAta),
      horarioAta,
      textoAta,
      estudantes: estudantesSelecionados.map(e => ({ nome: e.nome, turma: e.turma, ra: e.ra })),
      funcionarios: funcionariosSelecionados.map(f => ({ nome: f.nome, cargo: f.cargo })),
      outrosParticipantes
    };
  };

  const handleGerarPdf = async (ataItem?: AtaSalva) => {
    const dados = buildExportPayload(ataItem);
    if (!dados.textoAta.trim()) {
      setErroMensagem('Não há texto de ata disponível para gerar o PDF.');
      return;
    }
    setExportandoPdf(true);
    try {
      await gerarLivroAtaPdf(dados);
    } catch (err: any) {
      setErroMensagem(err?.message || 'Erro ao gerar o PDF do Livro Ata.');
    } finally {
      setExportandoPdf(false);
    }
  };

  const handleImprimir = (ataItem?: AtaSalva) => {
    const dados = buildExportPayload(ataItem);
    if (!dados.textoAta.trim()) {
      setErroMensagem('Não há texto de ata disponível para impressão.');
      return;
    }
    imprimirLivroAta(dados);
  };

  const handleCarregarNoEditor = (ataItem: AtaSalva) => {
    setTipoAta(ataItem.tipoAta || 'Outros');
    setDataAta(ataItem.dataAta || obterDataAtualISO());
    setHorarioAta(ataItem.horarioAta || obterHorarioAtual());
    setOutrosParticipantes(ataItem.outrosParticipantes || '');
    setNotasBrutas(ataItem.notasBrutas || '');
    setTextoAta(ataItem.textoAta || '');
    setErroMensagem(null);
    setSucessoInfo(null);
    setSubAba('nova');
  };

  const handleExcluirAta = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'atas_escolares', id));
      setAtasSalvas(prev => prev.filter(a => a.id !== id));
      setConfirmandoExclusaoId(null);
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Registro de ata removido do arquivo.', 'info');
      }
    } catch (err: any) {
      setErroMensagem(err?.message || 'Sem permissão ou erro ao excluir ata.');
      setConfirmandoExclusaoId(null);
    }
  };

  const atasFiltradas = useMemo(() => {
    const q = normalizarTextoBusca(buscaHist);
    return atasSalvas.filter(a => {
      if (filtroTipoHist !== 'TODOS' && a.tipoAta !== filtroTipoHist) return false;
      if (!q) return true;
      const participantes = [
        ...(a.estudantes || []).map(e => `${e.nome} ${e.turma || ''} ${e.ra || ''}`),
        ...(a.funcionarios || []).map(f => `${f.nome} ${f.cargo || ''}`),
        a.outrosParticipantes || ''
      ].join(' ');
      return normalizarTextoBusca(`${a.tipoAta} ${a.dataBR || a.dataAta || ''} ${participantes} ${a.textoAta}`).includes(q);
    });
  }, [atasSalvas, filtroTipoHist, buscaHist]);

  const totalParagrafos = useMemo(() => {
    return textoAta
      .split(/\n{2,}/)
      .map(p => p.trim())
      .filter(Boolean).length;
  }, [textoAta]);

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 space-y-5">
      {/* Cabeçalho Institucional Limpo */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Rotina &amp; Operações · Documentação Oficial SEDUC-SP
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-0.5 flex items-center gap-2.5">
            <i className="fa-solid fa-file-signature text-indigo-700 text-lg"></i>
            Gerador de Atas Inteligentes
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 mt-1">
            Redação formal nos moldes do Estado de São Paulo, saída em texto simples para Livro Ata e registro automático no dossiê (<span className="font-mono text-slate-700">acoes_2026</span>) dos envolvidos.
          </p>
        </div>

        {/* Sub-navegação segmentada */}
        <div className="inline-flex bg-slate-100 p-1 rounded-xl border border-slate-200 self-start md:self-auto shrink-0">
          <button
            type="button"
            onClick={() => setSubAba('nova')}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 transition cursor-pointer ${
              subAba === 'nova'
                ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <i className="fa-solid fa-pen-nib mr-1.5 text-indigo-600"></i>
            Nova Ata
          </button>
          <button
            type="button"
            onClick={() => setSubAba('historico')}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 transition cursor-pointer tabular-nums ${
              subAba === 'historico'
                ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <i className="fa-solid fa-book-bookmark mr-1.5 text-slate-500"></i>
            Atas Registradas ({atasSalvas.length})
          </button>
        </div>
      </div>

      {/* Alertas de Erro ou Sucesso */}
      {erroMensagem && (
        <div className="bg-rose-50 border border-rose-200 text-rose-900 rounded-xl px-4 py-3 text-sm flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <i className="fa-solid fa-circle-exclamation text-rose-600 mt-0.5"></i>
            <span>{erroMensagem}</span>
          </div>
          <button
            type="button"
            onClick={() => setErroMensagem(null)}
            className="text-rose-600 hover:text-rose-900 text-xs font-bold shrink-0 cursor-pointer"
          >
            Fechar
          </button>
        </div>
      )}

      {sucessoInfo && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-950 rounded-xl px-4 py-3 text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-start gap-2.5">
            <i className="fa-solid fa-circle-check text-emerald-600 mt-0.5"></i>
            <div>
              <div className="font-bold">Ata lavrada e integrada ao histórico escolar com sucesso.</div>
              <div className="text-xs text-emerald-800 mt-0.5 tabular-nums">
                Anotação registrada em <span className="font-mono font-semibold">acoes_2026</span>:{' '}
                <span className="font-semibold">"{sucessoInfo.anotacaoCurta}"</span> · {sucessoInfo.qtdAlunos} estudante(s) e{' '}
                {sucessoInfo.qtdFuncionarios} funcionário(s) atualizado(s).
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSucessoInfo(null)}
            className="text-emerald-700 hover:text-emerald-950 text-xs font-bold self-end sm:self-center shrink-0 cursor-pointer"
          >
            Dispensar
          </button>
        </div>
      )}

      {subAba === 'nova' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* COLUNA ESQUERDA: PARÂMETROS, PARTICIPANTES E NOTAS BRUTAS */}
          <div className="lg:col-span-5 space-y-4">
            {/* Bloco 1: Classificação & Data */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <h2 className="text-sm font-bold text-slate-900">1. Identificação da Reunião ou Atendimento</h2>
                <span className="text-[11px] font-medium text-slate-500">SEDUC-SP</span>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Tipo de Ata</label>
                <select
                  value={tipoAta}
                  onChange={e => setTipoAta(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-indigo-600 focus:outline-none"
                >
                  {TIPOS_ATA.map(tipo => (
                    <option key={tipo} value={tipo}>
                      {tipo}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Data</label>
                  <input
                    type="date"
                    value={dataAta}
                    onChange={e => setDataAta(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums focus:border-indigo-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Horário</label>
                  <input
                    type="time"
                    value={horarioAta}
                    onChange={e => setHorarioAta(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums focus:border-indigo-600 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Bloco 2: Seleção Múltipla de Estudantes */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <label className="text-sm font-bold text-slate-900">2. Estudantes Envolvidos</label>
                <span className="text-xs font-semibold text-slate-500 tabular-nums">
                  {estudantesSelecionados.length} selecionado(s)
                </span>
              </div>

              {estudantesSelecionados.length > 0 && (
                <div className="flex flex-wrap gap-1.5 p-2 rounded-xl bg-slate-50 border border-slate-200">
                  {estudantesSelecionados.map(est => (
                    <span
                      key={est.ra || est.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-xs font-semibold text-slate-800"
                    >
                      <span className="truncate max-w-[180px]">{est.nome}</span>
                      {est.turma && <span className="text-[11px] text-slate-500">· {est.turma}</span>}
                      <button
                        type="button"
                        onClick={() => toggleEstudante(est)}
                        className="text-slate-400 hover:text-rose-600 font-bold ml-0.5 cursor-pointer"
                        title="Remover estudante"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="relative">
                <i className="fa-solid fa-magnifying-glass text-slate-400 text-xs absolute left-3 top-1/2 -translate-y-1/2"></i>
                <input
                  type="text"
                  value={buscaEstudante}
                  onChange={e => setBuscaEstudante(e.target.value)}
                  placeholder="Buscar aluno por nome, RA ou turma..."
                  className="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-3 py-2 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:outline-none"
                />
              </div>

              <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white">
                {carregandoBases ? (
                  <div className="p-3 text-xs text-slate-500 text-center">Carregando base de estudantes...</div>
                ) : alunosFiltrados.length === 0 ? (
                  <div className="p-3 text-xs text-slate-500 text-center">Nenhum estudante encontrado.</div>
                ) : (
                  alunosFiltrados.map(est => {
                    const key = est.ra || est.id;
                    const marcado = estudantesSelecionados.some(s => (s.ra || s.id) === key);
                    return (
                      <label
                        key={key}
                        className={`flex items-center justify-between gap-2 px-3 py-2 text-xs cursor-pointer transition ${
                          marcado ? 'bg-indigo-50/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={marcado}
                            onChange={() => toggleEstudante(est)}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="font-semibold text-slate-800 truncate">{est.nome}</span>
                        </div>
                        <span className="text-[11px] text-slate-500 shrink-0 tabular-nums">
                          {est.turma || 'S/T'}{est.ra ? ` · ${est.ra}` : ''}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            {/* Bloco 3: Seleção Múltipla de Funcionários Presentes + Outros Participantes */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <label className="text-sm font-bold text-slate-900">3. Funcionários Presentes</label>
                <span className="text-xs font-semibold text-slate-500 tabular-nums">
                  {funcionariosSelecionados.length} selecionado(s)
                </span>
              </div>

              {funcionariosSelecionados.length > 0 && (
                <div className="flex flex-wrap gap-1.5 p-2 rounded-xl bg-slate-50 border border-slate-200">
                  {funcionariosSelecionados.map(func => (
                    <span
                      key={func.email || func.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-xs font-semibold text-slate-800"
                    >
                      <span className="truncate max-w-[180px]">{func.nome}</span>
                      {func.cargo && <span className="text-[11px] text-slate-500">· {func.cargo}</span>}
                      <button
                        type="button"
                        onClick={() => toggleFuncionario(func)}
                        className="text-slate-400 hover:text-rose-600 font-bold ml-0.5 cursor-pointer"
                        title="Remover funcionário"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="relative">
                <i className="fa-solid fa-magnifying-glass text-slate-400 text-xs absolute left-3 top-1/2 -translate-y-1/2"></i>
                <input
                  type="text"
                  value={buscaFuncionario}
                  onChange={e => setBuscaFuncionario(e.target.value)}
                  placeholder="Filtrar equipe por nome ou cargo..."
                  className="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-3 py-2 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:outline-none"
                />
              </div>

              <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white">
                {carregandoBases ? (
                  <div className="p-3 text-xs text-slate-500 text-center">Carregando equipe escolar...</div>
                ) : funcionariosFiltrados.length === 0 ? (
                  <div className="p-3 text-xs text-slate-500 text-center">Nenhum funcionário encontrado.</div>
                ) : (
                  funcionariosFiltrados.map(func => {
                    const key = func.email || func.id;
                    const marcado = funcionariosSelecionados.some(s => (s.email || s.id) === key);
                    return (
                      <label
                        key={key}
                        className={`flex items-center justify-between gap-2 px-3 py-2 text-xs cursor-pointer transition ${
                          marcado ? 'bg-indigo-50/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={marcado}
                            onChange={() => toggleFuncionario(func)}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="font-semibold text-slate-800 truncate">{func.nome}</span>
                        </div>
                        <span className="text-[11px] text-slate-500 shrink-0">{func.cargo}</span>
                      </label>
                    );
                  })
                )}
              </div>

              <div className="pt-1">
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Outros Participantes Presentes (Responsáveis, Conselho, Convidados)
                </label>
                <input
                  type="text"
                  value={outrosParticipantes}
                  onChange={e => setOutrosParticipantes(e.target.value)}
                  placeholder="Ex.: Maria Souza (mãe do aluno), Representante do Grêmio..."
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:outline-none"
                />
              </div>
            </div>

            {/* Bloco 4: Notas Brutas e Botão de IA */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <label className="text-sm font-bold text-slate-900">4. Notas Brutas (Rascunho Rápido)</label>
                <span className="text-[11px] text-slate-500">Uso interno · Não vai direto sem revisão</span>
              </div>

              <textarea
                rows={6}
                value={notasBrutas}
                onChange={e => setNotasBrutas(e.target.value)}
                placeholder="Anote de forma rápida e informal o que foi tratado, combinados feitos, orientações à família/estudante ou encaminhamentos da reunião..."
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:outline-none leading-relaxed"
              />

              <button
                type="button"
                onClick={handleEstruturarComIA}
                disabled={estruturandoIA || !notasBrutas.trim()}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-indigo-900 disabled:bg-slate-300 text-white font-bold text-sm flex items-center justify-center gap-2 transition whitespace-nowrap cursor-pointer disabled:cursor-not-allowed"
              >
                {estruturandoIA ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin"></i>
                    Estruturando Ata Oficial com IA...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-wand-magic-sparkles text-amber-300"></i>
                    Estruturar Ata com IA
                  </>
                )}
              </button>
            </div>
          </div>

          {/* COLUNA DIREITA: EDITOR EM TEXTO SIMPLES + LIVRO ATA + INTEGRAÇÃO */}
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-4 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-3">
              <div>
                <h2 className="text-base font-extrabold text-slate-900">
                  Texto Final da Ata (Texto Simples · Livro Ata)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                  Padrão oficial do Estado de São Paulo · {totalParagrafos} parágrafo(s) · {textoAta.length} caracteres
                </p>
              </div>

              <button
                type="button"
                onClick={() => handleCopiarTexto()}
                disabled={!textoAta.trim()}
                className="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-800 text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed"
              >
                <i className={`fa-solid ${copiado ? 'fa-check text-emerald-600' : 'fa-copy text-slate-500'}`}></i>
                {copiado ? 'Texto Copiado' : 'Copiar Texto Simples'}
              </button>
            </div>

            <textarea
              rows={16}
              value={textoAta}
              onChange={e => setTextoAta(e.target.value)}
              placeholder='Clique em "Estruturar Ata com IA" para converter as notas brutas em texto formal ("Aos ... dias do mês de..."), ou redija/edite diretamente aqui em texto simples com parágrafos separados por linha em branco.'
              className="w-full rounded-xl border border-slate-300 bg-slate-50/40 px-4 py-3.5 text-sm text-slate-900 leading-7 font-serif focus:bg-white focus:border-indigo-600 focus:outline-none"
            />

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-bold text-slate-800">
                  Registro resumido da conversa para o Dossiê dos envolvidos
                </label>
                <span className="text-[11px] text-slate-500">
                  Gerado automaticamente ao salvar se deixado em branco
                </span>
              </div>
              <textarea
                rows={2}
                value={resumoDossie}
                onChange={e => setResumoDossie(e.target.value)}
                placeholder="Opcional: personalize em 1–2 frases o resumo objetivo da conversa que aparecerá no Dossiê do Estudante e da Equipe..."
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-600 focus:outline-none"
              />
            </div>

            {/* Barra de Exportação & Integração */}
            <div className="pt-2 border-t border-slate-200 flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleGerarPdf()}
                  disabled={!textoAta.trim() || exportandoPdf}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-900 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed"
                >
                  <i className={`fa-solid ${exportandoPdf ? 'fa-spinner fa-spin' : 'fa-file-pdf text-rose-600'}`}></i>
                  Gerar PDF — Texto para o Livro Ata
                </button>

                <button
                  type="button"
                  onClick={() => handleImprimir()}
                  disabled={!textoAta.trim()}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-900 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed"
                >
                  <i className="fa-solid fa-print text-slate-700"></i>
                  Imprimir Livro Ata
                </button>
              </div>

              <button
                type="button"
                onClick={handleSalvarEIntegrar}
                disabled={!textoAta.trim() || salvandoAta}
                className="px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 whitespace-nowrap shrink-0 transition cursor-pointer disabled:cursor-not-allowed"
              >
                {salvandoAta ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin"></i>
                    Salvando e Integrando...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-floppy-disk"></i>
                    Salvar Ata &amp; Registrar nos Dossiês
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* SUB-ABA HISTÓRICO: ATAS REGISTRADAS */
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-4 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <div className="flex flex-wrap items-center gap-2.5 flex-1">
              <div className="relative flex-1 min-w-[220px]">
                <i className="fa-solid fa-magnifying-glass text-slate-400 text-xs absolute left-3 top-1/2 -translate-y-1/2"></i>
                <input
                  type="text"
                  value={buscaHist}
                  onChange={e => setBuscaHist(e.target.value)}
                  placeholder="Pesquisar atas por participante, data ou conteúdo..."
                  className="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-3 py-2 text-sm text-slate-900 focus:border-indigo-600 focus:outline-none"
                />
              </div>
              <select
                value={filtroTipoHist}
                onChange={e => setFiltroTipoHist(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 focus:border-indigo-600 focus:outline-none"
              >
                <option value="TODOS">Todos os Tipos</option>
                {TIPOS_ATA.map(t => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <span className="text-xs font-semibold text-slate-500 tabular-nums shrink-0">
              Exibindo {atasFiltradas.length} de {atasSalvas.length} registro(s)
            </span>
          </div>

          {atasFiltradas.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-sm">
              Nenhuma ata encontrada com os filtros atuais.
            </div>
          ) : (
            <div className="space-y-3">
              {atasFiltradas.map(ata => {
                const dataLabel = formatarDataBR(ata.dataAta, ata.dataBR);
                const qtdEst = (ata.estudantes || []).length;
                const qtdFunc = (ata.funcionarios || []).length;
                return (
                  <div
                    key={ata.id}
                    className="border border-slate-200 rounded-xl p-4 hover:border-slate-300 transition space-y-2.5"
                  >
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 tabular-nums">
                          <span className="font-bold text-slate-900 text-sm">{ata.tipoAta}</span>
                          <span>·</span>
                          <span>
                            {dataLabel}
                            {ata.horarioAta ? ` às ${ata.horarioAta}` : ''}
                          </span>
                          <span>·</span>
                          <span>
                            {qtdEst} estudante(s) · {qtdFunc} funcionário(s)
                          </span>
                          {ata.autorNome && (
                            <>
                              <span>·</span>
                              <span>Lavrada por {ata.autorNome}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleCarregarNoEditor(ata)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 whitespace-nowrap cursor-pointer"
                        >
                          <i className="fa-solid fa-pen-to-square mr-1 text-indigo-600"></i>
                          Abrir
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCopiarTexto(ata.textoAta)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 whitespace-nowrap cursor-pointer"
                        >
                          <i className="fa-solid fa-copy mr-1 text-slate-500"></i>
                          Copiar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleGerarPdf(ata)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 whitespace-nowrap cursor-pointer"
                        >
                          <i className="fa-solid fa-file-pdf mr-1 text-rose-600"></i>
                          PDF
                        </button>
                        <button
                          type="button"
                          onClick={() => handleImprimir(ata)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 whitespace-nowrap cursor-pointer"
                        >
                          <i className="fa-solid fa-print mr-1 text-slate-700"></i>
                          Imprimir
                        </button>
                        {confirmandoExclusaoId === ata.id ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleExcluirAta(ata.id)}
                              className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold whitespace-nowrap cursor-pointer"
                            >
                              Confirmar
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmandoExclusaoId(null)}
                              className="px-2 py-1.5 rounded-lg border border-slate-300 text-xs font-bold text-slate-600 cursor-pointer"
                            >
                              Não
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmandoExclusaoId(ata.id)}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-rose-300 hover:text-rose-700 text-xs font-bold text-slate-500 whitespace-nowrap cursor-pointer"
                          >
                            Excluir
                          </button>
                        )}
                      </div>
                    </div>

                    <p className="text-xs text-slate-700 leading-relaxed line-clamp-3 font-serif bg-slate-50 border border-slate-100 rounded-lg p-3 whitespace-pre-line">
                      {ata.textoAta}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
