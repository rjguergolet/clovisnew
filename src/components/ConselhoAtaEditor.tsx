import React, { useEffect, useMemo, useState } from 'react';
import {
  FileText,
  Save,
  Plus,
  Trash2,
  Users,
  Check,
  Sparkles,
  Eye,
  EyeOff,
  Search,
  RefreshCw,
  UserCheck,
  GraduationCap,
  ShieldCheck
} from 'lucide-react';
import { getAuthHeaders } from '../lib/auth';
import {
  AlunoConselhoClassificado,
  AtaConselhoTurmaData,
  DELIBERACAO_LABELS,
  MapaoConselhoMetadata,
  ParticipanteAssinaturaAta,
  resumirEstatisticasTurma
} from '../modules/mapaoConselhoParser';
import { exportarAtaConselhoOficialPDF } from '../utils/conselhoEspecialPdfExport';

interface ParticipanteServidor {
  nome: string;
  cargo: string;
  roleNorm: string;
  disciplina: string;
}

interface ConselhoAtaEditorProps {
  chaveTurmaBimestre: string;
  metadata: MapaoConselhoMetadata;
  alunos: AlunoConselhoClassificado[];
  ataInicial?: AtaConselhoTurmaData;
  observacoesGeraisTurma?: string;
  onSalvarAta: (ata: AtaConselhoTurmaData) => Promise<void>;
}

function hojeIsoLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function criarAtaPadrao(
  metadata: MapaoConselhoMetadata,
  ataSalva?: AtaConselhoTurmaData
): AtaConselhoTurmaData {
  if (ataSalva) {
    return {
      dataReuniao: ataSalva.dataReuniao || hojeIsoLocal(),
      horarioInicio: ataSalva.horarioInicio || '14:00',
      horarioFim: ataSalva.horarioFim || '15:30',
      localReuniao: ataSalva.localReuniao || 'Sala dos Professores / Coordenação Pedagógica',
      tituloPersonalizado: ataSalva.tituloPersonalizado || '',
      aberturaPanorama: ataSalva.aberturaPanorama || '',
      oqueFoiFaladoDiscurso: ataSalva.oqueFoiFaladoDiscurso || '',
      oqueFoiPensadoEstrategias: ataSalva.oqueFoiPensadoEstrategias || '',
      decisoesEncaminhamentos: ataSalva.decisoesEncaminhamentos || '',
      direcaoNome: ataSalva.direcaoNome || '',
      viceDirecaoNome: ataSalva.viceDirecaoNome || '',
      cgpgNome: ataSalva.cgpgNome || '',
      professores: Array.isArray(ataSalva.professores) ? ataSalva.professores : [],
      alunosRepresentantes: Array.isArray(ataSalva.alunosRepresentantes) ? ataSalva.alunosRepresentantes : [],
      convidados: Array.isArray(ataSalva.convidados) ? ataSalva.convidados : [],
      linhasEmBrancoProfessores:
        typeof ataSalva.linhasEmBrancoProfessores === 'number' ? ataSalva.linhasEmBrancoProfessores : 6,
      linhasEmBrancoAlunos:
        typeof ataSalva.linhasEmBrancoAlunos === 'number' ? ataSalva.linhasEmBrancoAlunos : 2,
      linhasEmBrancoConvidados:
        typeof ataSalva.linhasEmBrancoConvidados === 'number' ? ataSalva.linhasEmBrancoConvidados : 2,
      incluirTabelaDeliberacoes: ataSalva.incluirTabelaDeliberacoes !== false,
      incluirQuadroResultadoFinal:
        ataSalva.incluirQuadroResultadoFinal !== undefined
          ? ataSalva.incluirQuadroResultadoFinal
          : metadata.bimestreKey === 'FINAL',
      atualizadoPor: ataSalva.atualizadoPor,
      atualizadoEm: ataSalva.atualizadoEm
    };
  }

  return {
    dataReuniao: hojeIsoLocal(),
    horarioInicio: '14:00',
    horarioFim: '15:30',
    localReuniao: 'Sala dos Professores / Coordenação Pedagógica',
    tituloPersonalizado: '',
    aberturaPanorama: '',
    oqueFoiFaladoDiscurso: '',
    oqueFoiPensadoEstrategias: '',
    decisoesEncaminhamentos: '',
    direcaoNome: metadata.diretor || '',
    viceDirecaoNome: '',
    cgpgNome: '',
    professores: [],
    alunosRepresentantes: [],
    convidados: [],
    linhasEmBrancoProfessores: 6,
    linhasEmBrancoAlunos: 2,
    linhasEmBrancoConvidados: 2,
    incluirTabelaDeliberacoes: true,
    incluirQuadroResultadoFinal: metadata.bimestreKey === 'FINAL'
  };
}

export default function ConselhoAtaEditor({
  chaveTurmaBimestre,
  metadata,
  alunos,
  ataInicial,
  observacoesGeraisTurma,
  onSalvarAta
}: ConselhoAtaEditorProps) {
  const [ata, setAta] = useState<AtaConselhoTurmaData>(() => criarAtaPadrao(metadata, ataInicial));
  const [salvando, setSalvando] = useState(false);
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const [mostrarPreview, setMostrarPreview] = useState(false);

  // Participantes carregados do servidor (Gestão e Professores)
  const [gestaoLista, setGestaoLista] = useState<ParticipanteServidor[]>([]);
  const [professoresLista, setProfessoresLista] = useState<ParticipanteServidor[]>([]);
  const [carregandoPart, setCarregandoPart] = useState(false);
  const [buscaProf, setBuscaProf] = useState('');

  // Inputs manuais para adicionar participantes
  const [novoProfNome, setNovoProfNome] = useState('');
  const [novoProfDisc, setNovoProfDisc] = useState('');
  const [alunoRepSelect, setAlunoRepSelect] = useState('');
  const [novoAlunoNome, setNovoAlunoNome] = useState('');
  const [novoAlunoDet, setNovoAlunoDet] = useState('Representante de Turma');
  const [novoConvNome, setNovoConvNome] = useState('');
  const [novoConvFunc, setNovoConvFunc] = useState('');

  // Reinicializa rascunho quando muda a turma/bimestre
  useEffect(() => {
    setAta(criarAtaPadrao(metadata, ataInicial));
  }, [chaveTurmaBimestre, metadata.bimestreKey]);

  // Busca equipe gestora e docentes cadastrados no sistema
  useEffect(() => {
    let cancelled = false;
    const loadParticipantes = async () => {
      setCarregandoPart(true);
      try {
        const res = await fetch('/api/conselho-especial/participantes', {
          method: 'GET',
          headers: getAuthHeaders()
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const gestao: ParticipanteServidor[] = Array.isArray(data.gestao) ? data.gestao : [];
        const profs: ParticipanteServidor[] = Array.isArray(data.professores) ? data.professores : [];
        setGestaoLista(gestao);
        setProfessoresLista(profs);

        // Pré-preenche Direção, Vice e CGPG se ainda estiverem vazios no rascunho
        const dirAuto = gestao.find(g => g.roleNorm === 'DIRETOR' || g.roleNorm === 'SENIOR_GOE')?.nome || '';
        const viceAuto = gestao.find(g => g.roleNorm === 'VICE_DIRETOR')?.nome || '';
        const cgpgAuto = gestao.find(g => g.roleNorm === 'CGPG')?.nome || '';

        setAta(prev => ({
          ...prev,
          direcaoNome: prev.direcaoNome || dirAuto,
          viceDirecaoNome: prev.viceDirecaoNome || viceAuto,
          cgpgNome: prev.cgpgNome || cgpgAuto
        }));
      } catch {
        // Silencioso: usuário ainda pode digitar manualmente
      } finally {
        if (!cancelled) setCarregandoPart(false);
      }
    };
    loadParticipantes();
    return () => {
      cancelled = true;
    };
  }, [chaveTurmaBimestre]);

  const stats = useMemo(() => resumirEstatisticasTurma(alunos), [alunos]);
  const ativosOrdenados = useMemo(
    () => [...alunos].filter(a => a.isAtivo).sort((a, b) => a.numChamada - b.numChamada),
    [alunos]
  );

  const profSet = useMemo(
    () => new Set(ata.professores.map(p => p.nome.trim().toUpperCase())),
    [ata.professores]
  );

  const professoresFiltrados = useMemo(() => {
    const q = buscaProf.trim().toLowerCase();
    if (!q) return professoresLista;
    return professoresLista.filter(
      p => p.nome.toLowerCase().includes(q) || p.disciplina.toLowerCase().includes(q)
    );
  }, [professoresLista, buscaProf]);

  const toggleProfessorSistema = (p: ParticipanteServidor) => {
    const key = p.nome.trim().toUpperCase();
    setAta(prev => {
      const existe = prev.professores.some(item => item.nome.trim().toUpperCase() === key);
      if (existe) {
        return {
          ...prev,
          professores: prev.professores.filter(item => item.nome.trim().toUpperCase() !== key)
        };
      }
      return {
        ...prev,
        professores: [
          ...prev.professores,
          { nome: p.nome, detalhe: p.disciplina || p.cargo || 'Docente' }
        ]
      };
    });
  };

  const selecionarTodosProfessores = () => {
    setAta(prev => {
      const map = new Map<string, ParticipanteAssinaturaAta>();
      prev.professores.forEach(p => map.set(p.nome.trim().toUpperCase(), p));
      professoresLista.forEach(p => {
        const key = p.nome.trim().toUpperCase();
        if (!map.has(key)) {
          map.set(key, { nome: p.nome, detalhe: p.disciplina || 'Docente' });
        }
      });
      return { ...prev, professores: Array.from(map.values()) };
    });
  };

  const adicionarProfessorManual = () => {
    const nome = novoProfNome.trim();
    if (!nome) return;
    setAta(prev => ({
      ...prev,
      professores: [...prev.professores, { nome, detalhe: novoProfDisc.trim() || 'Professor(a)' }]
    }));
    setNovoProfNome('');
    setNovoProfDisc('');
  };

  const adicionarAlunoDaTurma = () => {
    const nome = alunoRepSelect.trim();
    if (!nome) return;
    if (ata.alunosRepresentantes.some(a => a.nome.toUpperCase() === nome.toUpperCase())) {
      setAlunoRepSelect('');
      return;
    }
    setAta(prev => ({
      ...prev,
      alunosRepresentantes: [
        ...prev.alunosRepresentantes,
        { nome, detalhe: `Representante Discente · ${metadata.turmaNormalizada}` }
      ]
    }));
    setAlunoRepSelect('');
  };

  const adicionarAlunoManual = () => {
    const nome = novoAlunoNome.trim();
    if (!nome) return;
    setAta(prev => ({
      ...prev,
      alunosRepresentantes: [
        ...prev.alunosRepresentantes,
        { nome, detalhe: novoAlunoDet.trim() || `Representante Discente · ${metadata.turmaNormalizada}` }
      ]
    }));
    setNovoAlunoNome('');
  };

  const adicionarConvidado = () => {
    const nome = novoConvNome.trim();
    if (!nome) return;
    setAta(prev => ({
      ...prev,
      convidados: [...prev.convidados, { nome, detalhe: novoConvFunc.trim() || 'Convidado(a)' }]
    }));
    setNovoConvNome('');
    setNovoConvFunc('');
  };

  // Preenche uma estrutura inicial fiel aos números reais da turma para acelerar a redação da ata
  const preencherBaseAutomatica = () => {
    const ativos = alunos.filter(a => a.isAtivo);
    const reprovFaltas = ativos.filter(a => a.reprovandoPorFaltasGlobal);
    const crit4 = ativos.filter(a => a.criticoNotas4Mais);
    const aeeLista = ativos.filter(a => a.isAEE);
    const deliberados = ativos.filter(a => a.deliberacao.status !== 'PENDENTE');

    const abertura = `A sessão iniciou com a leitura dos indicadores oficiais do Mapão da turma ${metadata.turmaNormalizada} (${stats.totalAtivos} estudantes ativos e ${stats.totalTransferidos} transferidos/inativos), registrando frequência média global anual de ${stats.mediaFreqAnual ?? '—'}% e média geral de notas em ${stats.mediaNotasTurma !== null ? stats.mediaNotasTurma.toFixed(1) : '—'}.`;

    const partesFalado: string[] = [];
    if (reprovFaltas.length > 0) {
      partesFalado.push(
        `Foram analisados individualmente os ${reprovFaltas.length} estudante(s) abaixo do mínimo legal de 75% na frequência global anual (${reprovFaltas.map(a => `${a.nome} (${a.freqAnualStr})`).slice(0, 6).join(', ')}${reprovFaltas.length > 6 ? ' e outros' : ''}), verificando justificativas familiares, atestados e necessidade de compensação de ausências.`
      );
    }
    if (crit4.length > 0) {
      partesFalado.push(
        `Os docentes comentaram o desempenho dos ${crit4.length} estudante(s) com 4 ou mais notas abaixo de 5,0 (${crit4.map(a => `${a.nome} (${a.qtdNotasVermelhas} verm.)`).slice(0, 6).join(', ')}${crit4.length > 6 ? ' e outros' : ''}), apontando dificuldades de engajamento, entrega de atividades e pontualidade.`
      );
    }
    if (aeeLista.length > 0) {
      partesFalado.push(
        `Foi dedicada atenção especial aos ${aeeLista.length} estudante(s) público-alvo da Educação Especial (AEE): ${aeeLista.map(a => a.nome).join(', ')}, avaliando o alcance das adaptações curriculares e participação com o professor auxiliar/sala de recursos.`
      );
    }
    if (partesFalado.length === 0) {
      partesFalado.push(
        'O grupo docente apresentou diagnóstico positivo de convivência, frequência e avanço de aprendizagem da turma no período analisado, destacando pontos pontuais de apoio pedagógico.'
      );
    }

    const pensado =
      'Como estratégias pedagógicas pensadas pelo coletivo: (1) intensificar o acompanhamento pela Tutoria PEI e contato imediato com os responsáveis dos casos em alerta; (2) aplicar roteiros de compensação de ausências (AC) e recuperação contínua/intensiva nas disciplinas com maior índice de retenção; (3) alinhar adaptações avaliativas e flexibilização de tempo/suporte visual para os estudantes AEE.';

    const decisoes =
      deliberados.length > 0
        ? `Foram registradas ${deliberados.length} deliberações individuais em pauta (${Array.from(new Set(deliberados.map(d => DELIBERACAO_LABELS[d.deliberacao.status]))).join('; ')}).${metadata.bimestreKey === 'FINAL' ? ` No Conselho Final, apurou-se até o momento: ${stats.aprovadosCount} aprovado(s), ${stats.aprovadosConselhoCount} aprovado(s) pelo Conselho e ${stats.reprovadosCount} retido(s), com respectiva definição de enturmação para ${metadata.anoLetivo + 1}.` : ''}`
        : 'Ficou deliberado o encaminhamento dos casos críticos à busca ativa, convocação formal de responsáveis com assinatura de termo de ciência e monitoramento semanal pela CGPG e Vice-Direção.';

    setAta(prev => ({
      ...prev,
      aberturaPanorama: prev.aberturaPanorama.trim() ? prev.aberturaPanorama : abertura,
      oqueFoiFaladoDiscurso: prev.oqueFoiFaladoDiscurso.trim() ? prev.oqueFoiFaladoDiscurso : partesFalado.join('\n\n'),
      oqueFoiPensadoEstrategias: prev.oqueFoiPensadoEstrategias.trim() ? prev.oqueFoiPensadoEstrategias : pensado,
      decisoesEncaminhamentos: prev.decisoesEncaminhamentos.trim() ? prev.decisoesEncaminhamentos : decisoes
    }));
  };

  const handleSalvar = async () => {
    setSalvando(true);
    try {
      await onSalvarAta(ata);
    } finally {
      setSalvando(false);
    }
  };

  const handleGerarPdf = async () => {
    setGerandoPdf(true);
    try {
      await onSalvarAta(ata);
      await exportarAtaConselhoOficialPDF(metadata, alunos, ata, observacoesGeraisTurma);
      if (typeof window !== 'undefined' && typeof (window as any).showToast === 'function') {
        (window as any).showToast('Ata Oficial do Conselho gerada em PDF e pronta para impressão.', 'success', 4000);
      }
    } catch (err: any) {
      if (typeof window !== 'undefined' && typeof (window as any).showToast === 'function') {
        (window as any).showToast(err?.message || 'Erro ao gerar PDF da Ata.', 'error', 4000);
      }
    } finally {
      setGerandoPdf(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* CABEÇALHO DO CONSTRUTOR DE ATA */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            <FileText className="w-3.5 h-3.5 text-slate-700" />
            <span>Livro Oficial de Atas · {metadata.turmaNormalizada}</span>
            <span aria-hidden="true">·</span>
            <span>{metadata.tipoFechamento}</span>
          </div>
          <h3 className="text-base font-bold text-slate-900">
            Redação da Ata e Folha de Assinaturas do Conselho (PDF)
          </h3>
          <p className="text-xs text-slate-600">
            Registre o que foi falado, pensado e decidido no conselho, selecione os professores, equipe gestora, estudantes e convidados, e gere a Ata oficial pronta para impressão.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={preencherBaseAutomatica}
            className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Sugerir Texto pelos Dados da Turma</span>
          </button>

          <button
            type="button"
            onClick={() => setMostrarPreview(v => !v)}
            className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            {mostrarPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            <span>{mostrarPreview ? 'Ocultar Prévia' : 'Pré-visualizar Ata'}</span>
          </button>

          <button
            type="button"
            disabled={salvando || gerandoPdf}
            onClick={handleSalvar}
            className="px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{salvando ? 'Salvando...' : 'Salvar Rascunho'}</span>
          </button>

          <button
            type="button"
            disabled={gerandoPdf || salvando}
            onClick={handleGerarPdf}
            className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            {gerandoPdf ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
            <span>{gerandoPdf ? 'Gerando PDF...' : 'Gerar Ata Oficial em PDF'}</span>
          </button>
        </div>
      </div>

      {/* PRÉVIA COMPACTA DA ATA (OPCIONAL) */}
      {mostrarPreview && (
        <div className="bg-white border border-slate-300 rounded-xl p-6 space-y-4 shadow-xs font-serif">
          <div className="border-b border-slate-300 pb-3 text-center space-y-1">
            <div className="text-[11px] uppercase tracking-wider text-slate-500">
              Governo do Estado de São Paulo · E.E. Prof. Clóvis de Lucca
            </div>
            <div className="text-base font-bold text-slate-900">
              {ata.tituloPersonalizado?.trim() ||
                (metadata.bimestreKey === 'FINAL'
                  ? `ATA DO CONSELHO DE CLASSE E SÉRIE FINAL — ${metadata.anoLetivo}`
                  : `ATA DO CONSELHO DE CLASSE (${metadata.tipoFechamento.toUpperCase()}) — ${metadata.anoLetivo}`)}
            </div>
            <div className="text-xs text-slate-600">
              Turma: {metadata.turmaNormalizada} · Data: {ata.dataReuniao} · Horário: {ata.horarioInicio} às {ata.horarioFim} · Local: {ata.localReuniao}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-800 font-sans">
            <div className="space-y-2">
              <div>
                <span className="font-bold text-slate-900">I. Abertura e Panorama: </span>
                <span>{ata.aberturaPanorama || 'Será preenchido com os indicadores oficiais do Mapão.'}</span>
              </div>
              <div>
                <span className="font-bold text-slate-900">II. O que foi Falado e Discutido: </span>
                <span>{ata.oqueFoiFaladoDiscurso || '(Sem registro até o momento)'}</span>
              </div>
            </div>
            <div className="space-y-2">
              <div>
                <span className="font-bold text-slate-900">III. O que foi Pensado e Proposto: </span>
                <span>{ata.oqueFoiPensadoEstrategias || '(Sem registro até o momento)'}</span>
              </div>
              <div>
                <span className="font-bold text-slate-900">IV. Decisões Coletivas: </span>
                <span>{ata.decisoesEncaminhamentos || '(Sem registro até o momento)'}</span>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-3 text-xs text-slate-600 font-sans flex flex-wrap gap-x-4 gap-y-1">
            <span>Gestão: 3 espaços (Direção, Vice, CGPG)</span>
            <span aria-hidden="true">·</span>
            <span>
              Professores: {ata.professores.length} selecionados + {ata.linhasEmBrancoProfessores} linhas em branco
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Alunos: {ata.alunosRepresentantes.length} + {ata.linhasEmBrancoAlunos} em branco
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Convidados: {ata.convidados.length} + {ata.linhasEmBrancoConvidados} em branco
            </span>
          </div>
        </div>
      )}

      {/* BLOCO 1: METADADOS DA SESSÃO + REGISTROS DO QUE FOI FALADO, PENSADO E DISCUTIDO */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h4 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
            1. Dados da Sessão e Relato Oficial da Reunião
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Data do Conselho</label>
              <input
                type="date"
                value={ata.dataReuniao}
                onChange={e => setAta(prev => ({ ...prev, dataReuniao: e.target.value }))}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-slate-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Início</label>
              <input
                type="time"
                value={ata.horarioInicio}
                onChange={e => setAta(prev => ({ ...prev, horarioInicio: e.target.value }))}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-slate-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Encerramento</label>
              <input
                type="time"
                value={ata.horarioFim}
                onChange={e => setAta(prev => ({ ...prev, horarioFim: e.target.value }))}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-slate-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Local</label>
              <input
                type="text"
                value={ata.localReuniao}
                onChange={e => setAta(prev => ({ ...prev, localReuniao: e.target.value }))}
                placeholder="Sala dos Professores"
                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-slate-400"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Título Personalizado da Ata (opcional — deixe em branco para usar o título oficial automático)
            </label>
            <input
              type="text"
              value={ata.tituloPersonalizado || ''}
              onChange={e => setAta(prev => ({ ...prev, tituloPersonalizado: e.target.value }))}
              placeholder={
                metadata.bimestreKey === 'FINAL'
                  ? `ATA DO CONSELHO DE CLASSE E SÉRIE FINAL — ${metadata.anoLetivo}`
                  : `ATA DO CONSELHO DE CLASSE (${metadata.tipoFechamento.toUpperCase()}) — ${metadata.anoLetivo}`
              }
              className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-slate-400"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              I. Abertura e Panorama Inicial do Mapão (complemento ao resumo numérico)
            </label>
            <textarea
              rows={2}
              value={ata.aberturaPanorama}
              onChange={e => setAta(prev => ({ ...prev, aberturaPanorama: e.target.value }))}
              placeholder="Descreva a abertura dos trabalhos pela Equipe Gestora, contextualização do bimestre/ano e panorama geral da turma..."
              className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-slate-400 resize-y"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-900 mb-1">
              II. O que foi Falado e Discutido no Conselho (fala dos docentes, gestão, alunos e AEE)
            </label>
            <textarea
              rows={4}
              value={ata.oqueFoiFaladoDiscurso}
              onChange={e => setAta(prev => ({ ...prev, oqueFoiFaladoDiscurso: e.target.value }))}
              placeholder="Registre os pontos levantados pelos professores sobre aprendizagem, comportamento, frequência, alunos críticos em faltas ou notas vermelhas e observações sobre estudantes AEE..."
              className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-slate-400 resize-y"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-900 mb-1">
              III. O que foi Pensado e Proposto (ideias, estratégias pedagógicas, compensação de ausências e recuperação)
            </label>
            <textarea
              rows={4}
              value={ata.oqueFoiPensadoEstrategias}
              onChange={e => setAta(prev => ({ ...prev, oqueFoiPensadoEstrategias: e.target.value }))}
              placeholder="Registre as hipóteses, adaptações de atividades, intervenções da tutoria PEI, planos de compensação de faltas (AC), recuperação intensiva e apoios ao AEE pensados pelo grupo..."
              className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-slate-400 resize-y"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-900 mb-1">
              IV. Decisões Coletivas, Encaminhamentos e Combinados Finais
            </label>
            <textarea
              rows={3}
              value={ata.decisoesEncaminhamentos}
              onChange={e => setAta(prev => ({ ...prev, decisoesEncaminhamentos: e.target.value }))}
              placeholder="Registre o que ficou oficialmente definido pelo conselho (convocações de família, encaminhamentos de promoção/retenção no conselho final, prazos e responsáveis)..."
              className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-slate-400 resize-y"
            />
          </div>

          <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-4 text-xs text-slate-700">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={ata.incluirTabelaDeliberacoes}
                onChange={e => setAta(prev => ({ ...prev, incluirTabelaDeliberacoes: e.target.checked }))}
                className="rounded border-slate-300 text-slate-900"
              />
              <span>Incluir Quadro de Deliberações Individuais (Pauta)</span>
            </label>
            {metadata.bimestreKey === 'FINAL' && (
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ata.incluirQuadroResultadoFinal}
                  onChange={e => setAta(prev => ({ ...prev, incluirQuadroResultadoFinal: e.target.checked }))}
                  className="rounded border-slate-300 text-slate-900"
                />
                <span>Incluir Quadro de Resultado Final e Turma {metadata.anoLetivo + 1}</span>
              </label>
            )}
          </div>
        </div>

        {/* BLOCO 2: PARTICIPANTES E ESPAÇOS DE ASSINATURA PARA IMPRESSÃO */}
        <div className="xl:col-span-5 space-y-5">
          {/* 2A. EQUIPE GESTORA */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-slate-700" />
                <span>2. Equipe Gestora (Direção, Vice e CGPG)</span>
              </h4>
              {carregandoPart && <span className="text-[11px] text-slate-400">Buscando equipe...</span>}
            </div>

            <div className="space-y-2.5">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Direção Escolar</label>
                <input
                  type="text"
                  list="lista-gestao-ata"
                  value={ata.direcaoNome}
                  onChange={e => setAta(prev => ({ ...prev, direcaoNome: e.target.value }))}
                  placeholder="Nome completo do(a) Diretor(a)"
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-slate-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Vice-Direção Escolar</label>
                <input
                  type="text"
                  list="lista-gestao-ata"
                  value={ata.viceDirecaoNome}
                  onChange={e => setAta(prev => ({ ...prev, viceDirecaoNome: e.target.value }))}
                  placeholder="Nome completo do(a) Vice-Diretor(a)"
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-slate-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">CGPG (Coordenação Pedagógica)</label>
                <input
                  type="text"
                  list="lista-gestao-ata"
                  value={ata.cgpgNome}
                  onChange={e => setAta(prev => ({ ...prev, cgpgNome: e.target.value }))}
                  placeholder="Nome completo do(a) CGPG"
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-slate-400"
                />
              </div>
              <datalist id="lista-gestao-ata">
                {gestaoLista.map(g => (
                  <option key={g.nome} value={g.nome}>
                    {g.cargo}
                  </option>
                ))}
              </datalist>
            </div>
          </div>

          {/* 2B. CORPO DOCENTE (VÁRIOS PROFESSORES) */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Users className="w-4 h-4 text-slate-700" />
                <span>3. Professores para Assinatura ({ata.professores.length})</span>
              </h4>
              <div className="flex items-center gap-2 text-[11px]">
                {professoresLista.length > 0 && (
                  <button
                    type="button"
                    onClick={selecionarTodosProfessores}
                    className="font-semibold text-slate-700 hover:text-slate-900 underline cursor-pointer"
                  >
                    Marcar todos ({professoresLista.length})
                  </button>
                )}
                {ata.professores.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setAta(prev => ({ ...prev, professores: [] }))}
                    className="font-semibold text-rose-700 hover:text-rose-800 underline cursor-pointer"
                  >
                    Limpar
                  </button>
                )}
              </div>
            </div>

            {professoresLista.length > 0 && (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={buscaProf}
                    onChange={e => setBuscaProf(e.target.value)}
                    placeholder="Filtrar professor(a) ou disciplina cadastrada..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-slate-400"
                  />
                </div>
                <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {professoresFiltrados.map(p => {
                    const checked = profSet.has(p.nome.trim().toUpperCase());
                    return (
                      <button
                        key={p.nome}
                        type="button"
                        onClick={() => toggleProfessorSistema(p)}
                        className={`w-full px-3 py-1.5 text-left text-xs flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                          checked ? 'bg-slate-900 text-white' : 'bg-white hover:bg-slate-50 text-slate-800'
                        }`}
                      >
                        <div className="min-w-0 truncate">
                          <span className="font-semibold">{p.nome}</span>
                          {p.disciplina && (
                            <span className={`ml-1.5 text-[11px] ${checked ? 'text-slate-300' : 'text-slate-500'}`}>
                              · {p.disciplina}
                            </span>
                          )}
                        </div>
                        {checked && <Check className="w-3.5 h-3.5 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Adicionar Professor manualmente */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <input
                type="text"
                value={novoProfNome}
                onChange={e => setNovoProfNome(e.target.value)}
                placeholder="Nome do(a) Professor(a)"
                className="sm:col-span-6 px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-slate-400"
              />
              <input
                type="text"
                value={novoProfDisc}
                onChange={e => setNovoProfDisc(e.target.value)}
                placeholder="Disciplina (ex: Matemática)"
                className="sm:col-span-4 px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-slate-400"
              />
              <button
                type="button"
                onClick={adicionarProfessorManual}
                className="sm:col-span-2 px-2.5 py-1.5 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-900 rounded-lg inline-flex items-center justify-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </div>

            {ata.professores.length > 0 && (
              <div className="max-h-36 overflow-y-auto space-y-1">
                {ata.professores.map((p, idx) => (
                  <div
                    key={`${p.nome}_${idx}`}
                    className="flex items-center justify-between gap-2 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded text-xs"
                  >
                    <div className="min-w-0 truncate">
                      <span className="font-semibold text-slate-900">{p.nome}</span>
                      {p.detalhe && <span className="text-slate-500 ml-1.5">({p.detalhe})</span>}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setAta(prev => ({
                          ...prev,
                          professores: prev.professores.filter((_, i) => i !== idx)
                        }))
                      }
                      className="text-slate-400 hover:text-rose-700 cursor-pointer shrink-0"
                      title="Remover professor"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-1 text-xs">
              <span className="text-slate-600 font-medium">
                Linhas em branco extras para professores na impressão:
              </span>
              <input
                type="number"
                min={0}
                max={30}
                value={ata.linhasEmBrancoProfessores}
                onChange={e =>
                  setAta(prev => ({
                    ...prev,
                    linhasEmBrancoProfessores: Math.max(0, Math.min(30, parseInt(e.target.value, 10) || 0))
                  }))
                }
                className="w-16 px-2 py-1 text-xs font-mono tabular-nums text-center bg-slate-50 border border-slate-200 rounded-md"
              />
            </div>
          </div>

          {/* 2C. ESTUDANTES REPRESENTANTES & CONVIDADOS */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="space-y-2.5">
              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5 border-b border-slate-100 pb-2">
                <GraduationCap className="w-4 h-4 text-slate-700" />
                <span>4. Alunos Representantes ({ata.alunosRepresentantes.length})</span>
              </h4>

              {ativosOrdenados.length > 0 && (
                <div className="flex gap-2">
                  <select
                    value={alunoRepSelect}
                    onChange={e => setAlunoRepSelect(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 cursor-pointer"
                  >
                    <option value="">Selecionar estudante da turma...</option>
                    {ativosOrdenados.map(a => (
                      <option key={a.chaveAluno} value={a.nome}>
                        {a.numChamada} - {a.nome}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={adicionarAlunoDaTurma}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-900 rounded-lg cursor-pointer whitespace-nowrap"
                  >
                    Incluir
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                <input
                  type="text"
                  value={novoAlunoNome}
                  onChange={e => setNovoAlunoNome(e.target.value)}
                  placeholder="Ou digite nome do(a) estudante"
                  className="sm:col-span-6 px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                />
                <input
                  type="text"
                  value={novoAlunoDet}
                  onChange={e => setNovoAlunoDet(e.target.value)}
                  placeholder="Função (ex: Líder de Turma)"
                  className="sm:col-span-4 px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                />
                <button
                  type="button"
                  onClick={adicionarAlunoManual}
                  className="sm:col-span-2 px-2.5 py-1.5 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-900 rounded-lg inline-flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add</span>
                </button>
              </div>

              {ata.alunosRepresentantes.length > 0 && (
                <div className="space-y-1">
                  {ata.alunosRepresentantes.map((al, idx) => (
                    <div
                      key={`${al.nome}_${idx}`}
                      className="flex items-center justify-between gap-2 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded text-xs"
                    >
                      <span className="truncate font-medium text-slate-800">
                        {al.nome} {al.detalhe ? `(${al.detalhe})` : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setAta(prev => ({
                            ...prev,
                            alunosRepresentantes: prev.alunosRepresentantes.filter((_, i) => i !== idx)
                          }))
                        }
                        className="text-slate-400 hover:text-rose-700 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-600">Linhas em branco para alunos na impressão:</span>
                <input
                  type="number"
                  min={0}
                  max={15}
                  value={ata.linhasEmBrancoAlunos}
                  onChange={e =>
                    setAta(prev => ({
                      ...prev,
                      linhasEmBrancoAlunos: Math.max(0, Math.min(15, parseInt(e.target.value, 10) || 0))
                    }))
                  }
                  className="w-16 px-2 py-1 text-xs font-mono tabular-nums text-center bg-slate-50 border border-slate-200 rounded-md"
                />
              </div>
            </div>

            {/* CONVIDADOS */}
            <div className="space-y-2.5 pt-3 border-t border-slate-100">
              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <UserCheck className="w-4 h-4 text-slate-700" />
                <span>5. Convidados / Responsáveis / Equipe de Apoio ({ata.convidados.length})</span>
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                <input
                  type="text"
                  value={novoConvNome}
                  onChange={e => setNovoConvNome(e.target.value)}
                  placeholder="Nome do(a) convidado(a)"
                  className="sm:col-span-6 px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                />
                <input
                  type="text"
                  value={novoConvFunc}
                  onChange={e => setNovoConvFunc(e.target.value)}
                  placeholder="Função (ex: Prof. AEE, Grêmio, Pais)"
                  className="sm:col-span-4 px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                />
                <button
                  type="button"
                  onClick={adicionarConvidado}
                  className="sm:col-span-2 px-2.5 py-1.5 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-900 rounded-lg inline-flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add</span>
                </button>
              </div>

              {ata.convidados.length > 0 && (
                <div className="space-y-1">
                  {ata.convidados.map((c, idx) => (
                    <div
                      key={`${c.nome}_${idx}`}
                      className="flex items-center justify-between gap-2 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded text-xs"
                    >
                      <span className="truncate font-medium text-slate-800">
                        {c.nome} {c.detalhe ? `(${c.detalhe})` : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setAta(prev => ({
                            ...prev,
                            convidados: prev.convidados.filter((_, i) => i !== idx)
                          }))
                        }
                        className="text-slate-400 hover:text-rose-700 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-600">Linhas em branco para convidados na impressão:</span>
                <input
                  type="number"
                  min={0}
                  max={15}
                  value={ata.linhasEmBrancoConvidados}
                  onChange={e =>
                    setAta(prev => ({
                      ...prev,
                      linhasEmBrancoConvidados: Math.max(0, Math.min(15, parseInt(e.target.value, 10) || 0))
                    }))
                  }
                  className="w-16 px-2 py-1 text-xs font-mono tabular-nums text-center bg-slate-50 border border-slate-200 rounded-md"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
