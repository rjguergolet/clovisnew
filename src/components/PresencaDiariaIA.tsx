import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { db, collection, getDocs, setDoc, doc, onSnapshot } from '../lib/database';
import { obterUsuarioAtivoCompleto } from '../modules/authHelper';
import { isAlunoAtivo } from '../utils';
import { checkDayStatus, DayStatusResult } from './agendaConstants';

type StatusPresenca = 'presente' | 'atrasado' | 'falta' | 'licenca';
type OrigemRegistro = 'manual' | 'dispensa' | 'atraso_ocorrencia' | 'pendente';

interface RegistroPresencaItem {
  status: StatusPresenca;
  horarioAtraso?: string;
  motivoLicenca?: string;
  verificado?: boolean;
  manualOverride?: boolean;
  origem?: OrigemRegistro;
  atualizadoEm?: string;
}

interface DispensaPeriodo {
  dataInicio: string;
  dataFim: string;
  motivo: string;
  descricao?: string;
  registradoPor?: string;
}

interface AtrasoDiaInfo {
  horario: string;
  descricao?: string;
  registradoPor?: string;
}

interface AlunoPresenca {
  id: string;
  ra: string;
  nome: string;
  turma: string;
  tutor: string;
  telefone: string;
  status: StatusPresenca;
  verificado: boolean;
  origem: OrigemRegistro;
  horarioAtraso: string;
  motivoLicenca: string;
  dispensaAtiva?: DispensaPeriodo | null;
  atrasoOcorrencia?: AtrasoDiaInfo | null;
  faltasTotais: number;
  licencasAfastamentos: number;
  faltasEfetivas: number;
  atrasosAcumulados: number;
  faltasConsecutivas: number;
}

const ANO_LETIVO_OPERACAO = '2027';

function normalizarRaChave(val: unknown): string {
  return String(val || '').replace(/\D/g, '');
}

function toLocalYmd(raw: unknown): string {
  if (!raw) return '';
  const s = String(raw).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [d, m, y] = s.split('/');
    return `${y}-${m}-${d}`;
  }
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s.slice(0, 10))) {
    return s.slice(0, 10);
  }
  return '';
}

function formatarDataBr(ymd: string): string {
  if (!ymd || !ymd.includes('-')) return ymd;
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

function formatarDiaCurtoBr(ymd: string): string {
  if (!ymd || !ymd.includes('-')) return ymd;
  const [, m, d] = ymd.split('-');
  return `${d}/${m}`;
}

function extrairHoraAtraso(oc: any): string {
  const direto = oc?.horarioAtraso || oc?.horaRealAtraso || oc?.horaAtraso;
  if (direto && /^\d{1,2}:\d{2}/.test(String(direto).trim())) {
    return String(direto).trim().slice(0, 5);
  }
  const desc = String(oc?.descricao || '');
  const match = desc.match(/(?:chegada(?:\s+às)?|às)\s*(\d{1,2}:\d{2})/i);
  if (match?.[1]) {
    return match[1].padStart(5, '0');
  }
  const rawDt = String(oc?.data || '');
  if (rawDt.includes('T')) {
    const dt = new Date(rawDt);
    if (!isNaN(dt.getTime())) {
      return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
    }
  }
  return '07:15';
}

function turmaSortRank(turmaStr: string): [number, string] {
  const norm = String(turmaStr || '').toUpperCase().trim();
  const match = norm.match(/^(\d{1,2})\s*(º|°|ª|A|B|C|D|E)?/);
  if (!match) return [999, norm];
  const num = parseInt(match[1], 10);
  const isEnsinoMedio =
    norm.includes('SÉRIE') ||
    norm.includes('SERIE') ||
    norm.includes('EM') ||
    norm.includes('ª') ||
    (num >= 1 && num <= 3);
  if (num >= 6 && num <= 9 && !isEnsinoMedio) {
    return [num, norm];
  }
  if (isEnsinoMedio && num >= 1 && num <= 3) {
    return [10 + num, norm];
  }
  return [50 + num, norm];
}

function compararTurmas(a: string, b: string): number {
  const [rA, sA] = turmaSortRank(a);
  const [rB, sB] = turmaSortRank(b);
  if (rA !== rB) return rA - rB;
  return sA.localeCompare(sB, 'pt-BR', { numeric: true, sensitivity: 'base' });
}

function isOcorrenciaDispensaValid(oc: any): boolean {
  if (!oc) return false;
  if (oc.isDispensa === true && (oc.dataInicio || oc.dataFim)) return true;
  const tipo = String(oc.tipo || oc.categoria || '').toUpperCase();
  return (tipo.includes('DISPENSA') || tipo.includes('AFASTAMENTO LEGAL')) && Boolean(oc.dataInicio || oc.dataFim);
}

function isOcorrenciaAtrasoValid(oc: any): boolean {
  if (!oc || isOcorrenciaDispensaValid(oc)) return false;
  if (oc.isAtraso === true) return true;
  const tipo = String(oc.tipo || '').toUpperCase();
  const cat = String(oc.categoria || '').toUpperCase();
  const desc = String(oc.descricao || '').toUpperCase();
  return tipo.includes('ATRASO') || cat.includes('ATRASO') || desc.startsWith('ATRASO');
}

export default function PresencaDiariaIA() {
  const hojeIso = useMemo(() => {
    const dt = new Date();
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, []);

  const [dataSelecionada, setDataSelecionada] = useState<string>(() => {
    try {
      const ultima = localStorage.getItem('clovis_presenca_2027_ultima_data');
      if (ultima && /^\d{4}-\d{2}-\d{2}$/.test(ultima)) return ultima;
    } catch {}
    return hojeIso;
  });

  const [turmaSelecionada, setTurmaSelecionada] = useState<string>('TODAS');
  const [filtroBusca, setFiltroBusca] = useState<string>('');
  const [filtroStatus, setFiltroStatus] = useState<string>('TODOS');
  const [turmasRecolhidas, setTurmasRecolhidas] = useState<Record<string, boolean>>({});
  const [forcarChamadaDiaNaoLetivo, setForcarChamadaDiaNaoLetivo] = useState(false);

  const [alunosBase, setAlunosBase] = useState<any[]>([]);
  const [eventosAgenda, setEventosAgenda] = useState<any[]>(() =>
    Array.isArray((window as any).eventosCache) ? (window as any).eventosCache : []
  );
  const [ocorrenciasLista, setOcorrenciasLista] = useState<any[]>(() =>
    Array.isArray((window as any).ocorrenciasCache) ? (window as any).ocorrenciasCache : []
  );

  const [registrosPresenca, setRegistrosPresenca] = useState<Record<string, RegistroPresencaItem>>({});
  const [ultimoSalvamentoTexto, setUltimoSalvamentoTexto] = useState<string>('');
  const [statusSalvamentoDoc, setStatusSalvamentoDoc] = useState<'rascunho' | 'em_andamento' | 'concluida'>('rascunho');

  const [historicoChamadas, setHistoricoChamadas] = useState<any[]>([]);
  const [licencasAjuste, setLicencasAjuste] = useState<Record<string, number>>({});

  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);

  // Modais
  const [modalWhatsappAberto, setModalWhatsappAberto] = useState(false);
  const [textoMensagemWhatsapp, setTextoMensagemWhatsapp] = useState('');
  const [tomComunicado, setTomComunicado] = useState<'acolhedor' | 'padrao' | 'urgente'>('acolhedor');
  const [origemMensagemIa, setOrigemMensagemIa] = useState<'gemini' | 'fallback' | null>(null);
  const [gerandoMensagemIa, setGerandoMensagemIa] = useState(false);

  const [modalIaAnaliseAberto, setModalIaAnaliseAberto] = useState(false);
  const [analiseIaDados, setAnaliseIaDados] = useState<any | null>(null);
  const [gerandoAnaliseIa, setGerandoAnaliseIa] = useState(false);

  const activeUser = useMemo(() => obterUsuarioAtivoCompleto(), []);
  const autoSaveTimerRef = useRef<number | null>(null);
  const registrosEditadosLocalmenteRef = useRef<boolean>(false);

  // Salva última data acessada para facilitar retorno
  useEffect(() => {
    try {
      localStorage.setItem('clovis_presenca_2027_ultima_data', dataSelecionada);
    } catch {}
    setForcarChamadaDiaNaoLetivo(false);
    registrosEditadosLocalmenteRef.current = false;
  }, [dataSelecionada]);

  // 1. Escutar estudantes em tempo real (captura também dispensas gravadas no documento do aluno)
  useEffect(() => {
    let cancelado = false;
    setLoading(true);

    const mem = (window as any).allStudentsData;
    if (Array.isArray(mem) && mem.length > 0) {
      setAlunosBase(mem.filter(isAlunoAtivo));
      setLoading(false);
    }

    const unsub = onSnapshot(
      collection(db, 'alunos'),
      (snap) => {
        if (cancelado) return;
        const docs: any[] = [];
        snap.forEach((d: any) => docs.push({ id: d.id, ...d.data() }));
        if (docs.length > 0) {
          setAlunosBase(docs.filter(isAlunoAtivo));
        }
        setLoading(false);
      },
      (err) => {
        console.warn('Erro ao escutar coleção alunos:', err);
        setLoading(false);
      }
    );

    return () => {
      cancelado = true;
      unsub();
    };
  }, []);

  // 2. Ligação com Agenda PEI (eventos) para saber exatamente quais dias têm aula
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'eventos'),
      (snap) => {
        const list: any[] = [];
        snap.forEach((docSnap: any) => {
          const d = docSnap.data();
          const dtIni = d.dataInicio || d.data || d.dataLimite || '';
          if (dtIni) {
            list.push({
              id: docSnap.id,
              ...d,
              dataInicio: dtIni,
              dataFim: d.dataFim || dtIni
            });
          }
        });
        setEventosAgenda(list);
      },
      (err) => {
        console.warn('Erro ao escutar eventos da Agenda PEI:', err);
      }
    );
    return () => unsub();
  }, []);

  // 3. Ligação com Registros / Ocorrências (Dispensas com datas + Atrasos registrados no sistema)
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'ocorrencias'),
      (snap) => {
        const list: any[] = [];
        snap.forEach((docSnap: any) => {
          list.push({ id: docSnap.id, ...docSnap.data() });
        });
        setOcorrenciasLista(list);
      },
      (err) => {
        console.warn('Erro ao escutar ocorrências para Presença Diária:', err);
      }
    );

    const onOcorrenciasUpdated = () => {
      const cache = (window as any).ocorrenciasCache || (window as any).ocorrenciasTopLevel;
      if (Array.isArray(cache) && cache.length > 0) {
        setOcorrenciasLista([...cache]);
      }
    };
    window.addEventListener('clovis_ocorrencias_updated', onOcorrenciasUpdated);

    return () => {
      unsub();
      window.removeEventListener('clovis_ocorrencias_updated', onOcorrenciasUpdated);
    };
  }, []);

  // 4. Status letivo do dia selecionado conforme a Agenda PEI
  const dayStatus: DayStatusResult = useMemo(() => {
    return checkDayStatus(dataSelecionada, eventosAgenda);
  }, [dataSelecionada, eventosAgenda]);

  const eventosDoDiaAgenda = useMemo(() => {
    return (eventosAgenda || []).filter((ev) => {
      const start = ev.dataInicio || ev.data || '';
      const end = ev.dataFim || start;
      return Boolean(start) && dataSelecionada >= start && dataSelecionada <= end;
    });
  }, [eventosAgenda, dataSelecionada]);

  const podeLancarNoDia = dayStatus.isLetivo || forcarChamadaDiaNaoLetivo;

  // Navegar para dia letivo anterior ou próximo considerando Agenda PEI
  const handleNavegarDiaLetivo = (direcao: -1 | 1) => {
    const [y, m, d] = dataSelecionada.split('-').map((n) => parseInt(n, 10));
    const cursor = new Date(y, m - 1, d);
    for (let i = 0; i < 45; i++) {
      cursor.setDate(cursor.getDate() + direcao);
      const ymd = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
      if (checkDayStatus(ymd, eventosAgenda).isLetivo) {
        setDataSelecionada(ymd);
        return;
      }
    }
  };

  // 5. Carregar/escutar chamada salva para dataSelecionada (2027) com suporte a rascunho local
  useEffect(() => {
    const docId = `chamada_${dataSelecionada}_${ANO_LETIVO_OPERACAO}`;
    const docRef = doc(db, 'frequencia_diaria', docId);
    let carregouBanco = false;

    const carregarCacheLocal = () => {
      try {
        const raw = localStorage.getItem(`clovis_chamada_${docId}`);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.registros) {
          setRegistrosPresenca(parsed.registros);
          setStatusSalvamentoDoc(parsed.statusChamada || 'em_andamento');
          if (parsed.atualizadoEm) {
            const dt = new Date(parsed.atualizadoEm);
            if (!isNaN(dt.getTime())) {
              setUltimoSalvamentoTexto(`Rascunho local às ${dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
            }
          }
          return true;
        }
        if (parsed && typeof parsed === 'object') {
          setRegistrosPresenca(parsed);
          return true;
        }
      } catch {}
      return false;
    };

    const unsubscribe = onSnapshot(
      docRef,
      (docSnap) => {
        if (docSnap.exists() && docSnap.data()?.registros) {
          carregouBanco = true;
          const dataDoc = docSnap.data();
          setRegistrosPresenca(dataDoc.registros);
          setStatusSalvamentoDoc(dataDoc.statusChamada || 'em_andamento');
          if (dataDoc.atualizadoEm) {
            const dt = new Date(dataDoc.atualizadoEm);
            if (!isNaN(dt.getTime())) {
              setUltimoSalvamentoTexto(
                `Salvo em ${dt.toLocaleDateString('pt-BR')} às ${dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}${dataDoc.atualizadoPor ? ` · ${dataDoc.atualizadoPor}` : ''}`
              );
            }
          }
        } else if (!carregouBanco) {
          const achouLocal = carregarCacheLocal();
          if (!achouLocal) {
            setRegistrosPresenca({});
            setStatusSalvamentoDoc('rascunho');
            setUltimoSalvamentoTexto('');
          }
        }
      },
      (err) => {
        console.warn('Erro ao escutar frequencia_diaria:', err);
        carregarCacheLocal();
      }
    );

    return () => unsubscribe();
  }, [dataSelecionada]);

  // 6. Auto-save silencioso em localStorage quando há alterações para permitir retomar depois sem perda
  useEffect(() => {
    if (!registrosEditadosLocalmenteRef.current) return;
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);

    autoSaveTimerRef.current = window.setTimeout(() => {
      const docId = `chamada_${dataSelecionada}_${ANO_LETIVO_OPERACAO}`;
      const agoraIso = new Date().toISOString();
      try {
        localStorage.setItem(
          `clovis_chamada_${docId}`,
          JSON.stringify({
            registros: registrosPresenca,
            statusChamada: statusSalvamentoDoc,
            atualizadoEm: agoraIso
          })
        );
        const dt = new Date(agoraIso);
        setUltimoSalvamentoTexto(`Rascunho automático às ${dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
      } catch {}
    }, 600);

    return () => {
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    };
  }, [registrosPresenca, dataSelecionada, statusSalvamentoDoc]);

  // 7. Histórico completo de chamadas salvas em frequencia_diaria (2027)
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'frequencia_diaria'),
      (snap) => {
        const lista: any[] = [];
        snap.forEach((d: any) => lista.push({ id: d.id, ...d.data() }));
        setHistoricoChamadas(lista);
      },
      (err) => {
        console.warn('Erro ao carregar histórico de frequencia_diaria:', err);
      }
    );
    return () => unsubscribe();
  }, []);

  // 8. Ajustes manuais da 2ª métrica (2027)
  useEffect(() => {
    const ajusteKey = `licencas_ajuste_${ANO_LETIVO_OPERACAO}`;
    try {
      const cached = localStorage.getItem(`clovis_${ajusteKey}`);
      if (cached) setLicencasAjuste(JSON.parse(cached));
      else setLicencasAjuste({});
    } catch {
      setLicencasAjuste({});
    }

    const docRef = doc(db, 'config_escola', ajusteKey);
    const unsubscribe = onSnapshot(
      docRef,
      (docSnap) => {
        if (docSnap.exists() && docSnap.data()?.ajustes) {
          setLicencasAjuste(docSnap.data().ajustes);
        }
      },
      (err) => {
        console.warn('Erro ao escutar licenças ajustadas:', err);
      }
    );
    return () => unsubscribe();
  }, []);

  // 9. Indexar Dispensas com Datas e Atrasos do Dia a partir de 'ocorrencias' + 'alunos'
  const integracaoCruzada = useMemo(() => {
    const dispensasPorRa: Record<string, DispensaPeriodo[]> = {};
    const atrasosDiaPorRa: Record<string, AtrasoDiaInfo> = {};
    const atrasosCountOcorrenciasPorRa: Record<string, number> = {};
    const seenSigDispensa = new Set<string>();
    const seenSigAtraso = new Set<string>();

    const registrarDispensa = (raKey: string, d: DispensaPeriodo) => {
      if (!raKey || !d.dataInicio || !d.dataFim) return;
      const sig = `${raKey}|${d.dataInicio}|${d.dataFim}|${d.motivo}`;
      if (seenSigDispensa.has(sig)) return;
      seenSigDispensa.add(sig);
      if (!dispensasPorRa[raKey]) dispensasPorRa[raKey] = [];
      dispensasPorRa[raKey].push(d);
    };

    const registrarAtraso = (raKey: string, oc: any) => {
      if (!raKey) return;
      const dtYmd = toLocalYmd(oc.data || oc.createdAt);
      const horario = extrairHoraAtraso(oc);
      const sig = `${raKey}|${dtYmd}|${horario}|${String(oc.descricao || '').slice(0, 40)}`;
      if (seenSigAtraso.has(sig)) return;
      seenSigAtraso.add(sig);

      atrasosCountOcorrenciasPorRa[raKey] = (atrasosCountOcorrenciasPorRa[raKey] || 0) + 1;

      if (dtYmd === dataSelecionada) {
        atrasosDiaPorRa[raKey] = {
          horario,
          descricao: oc.descricao || '',
          registradoPor: oc.usuario || oc.autor || oc.autor_nome || ''
        };
      }
    };

    // Fontes: coleção top-level 'ocorrencias'
    ocorrenciasLista.forEach((oc) => {
      const raKey = normalizarRaChave(oc?.ra);
      if (!raKey) return;
      if (isOcorrenciaDispensaValid(oc)) {
        registrarDispensa(raKey, {
          dataInicio: toLocalYmd(oc.dataInicio),
          dataFim: toLocalYmd(oc.dataFim || oc.dataInicio),
          motivo: oc.motivoDispensa || 'Atestado Médico',
          descricao: oc.descricao || '',
          registradoPor: oc.usuario || oc.autor || ''
        });
      } else if (isOcorrenciaAtrasoValid(oc)) {
        registrarAtraso(raKey, oc);
      }
    });

    // Fontes: arrays embutidos em cada aluno (dispensas + ocorrencias)
    alunosBase.forEach((al) => {
      const raKey = normalizarRaChave(al?.ra || al?.id);
      if (!raKey) return;

      if (Array.isArray(al.dispensas)) {
        al.dispensas.forEach((d: any) => {
          if (d?.dataInicio || d?.dataFim) {
            registrarDispensa(raKey, {
              dataInicio: toLocalYmd(d.dataInicio),
              dataFim: toLocalYmd(d.dataFim || d.dataInicio),
              motivo: d.motivoDispensa || d.motivo || 'Atestado Médico',
              descricao: d.descricao || '',
              registradoPor: d.registradoPor || ''
            });
          }
        });
      }

      const embutidas = Array.isArray(al.ocorrencias) ? al.ocorrencias : Array.isArray(al.registros) ? al.registros : [];
      embutidas.forEach((oc: any) => {
        if (!oc) return;
        if (isOcorrenciaDispensaValid(oc)) {
          registrarDispensa(raKey, {
            dataInicio: toLocalYmd(oc.dataInicio),
            dataFim: toLocalYmd(oc.dataFim || oc.dataInicio),
            motivo: oc.motivoDispensa || 'Atestado Médico',
            descricao: oc.descricao || '',
            registradoPor: oc.usuario || oc.autor || ''
          });
        } else if (isOcorrenciaAtrasoValid(oc)) {
          registrarAtraso(raKey, oc);
        }
      });
    });

    // Calcular dias letivos cobertos pelas dispensas de cada aluno até a data limite
    const diasDispensaLetivosPorRa: Record<string, Set<string>> = {};
    const limiteRef = dataSelecionada > hojeIso ? dataSelecionada : hojeIso;

    Object.entries(dispensasPorRa).forEach(([raKey, lista]) => {
      const diasSet = new Set<string>();
      lista.forEach((d) => {
        const ini = d.dataInicio;
        const fim = d.dataFim > limiteRef ? limiteRef : d.dataFim;
        if (!ini || !fim || fim < ini) return;
        const [y1, m1, d1] = ini.split('-').map((n) => parseInt(n, 10));
        const [y2, m2, d2] = fim.split('-').map((n) => parseInt(n, 10));
        const cur = new Date(y1, m1 - 1, d1);
        const end = new Date(y2, m2 - 1, d2);
        let guard = 0;
        while (cur <= end && guard < 366) {
          const ymd = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
          if (checkDayStatus(ymd, eventosAgenda).isLetivo) {
            diasSet.add(ymd);
          }
          cur.setDate(cur.getDate() + 1);
          guard++;
        }
      });
      diasDispensaLetivosPorRa[raKey] = diasSet;
    });

    return {
      dispensasPorRa,
      atrasosDiaPorRa,
      atrasosCountOcorrenciasPorRa,
      diasDispensaLetivosPorRa
    };
  }, [ocorrenciasLista, alunosBase, dataSelecionada, hojeIso, eventosAgenda]);

  // 10. Lista única de turmas na ordem escolar (6º -> 9º -> 1ª EM -> 3ª EM)
  const listaTurmas = useMemo(() => {
    const s = new Set<string>();
    alunosBase.forEach((a) => {
      if (a.turma) s.add(String(a.turma).trim().toUpperCase());
    });
    return Array.from(s).sort(compararTurmas);
  }, [alunosBase]);

  // 11. Agregação contínua multi-dias (considerando dispensas cruzadas)
  const historicoAgregado = useMemo(() => {
    const docIdAtual = `chamada_${dataSelecionada}_${ANO_LETIVO_OPERACAO}`;
    const mapaPorRa: Record<
      string,
      {
        faltasDiario: number;
        licencasDiario: number;
        datasLicencaRegistradas: Set<string>;
        atrasosDiario: number;
        datasAtrasoRegistradas: Set<string>;
        faltasConsecutivas: number;
      }
    > = {};

    const atrasosPorDiaSemana: Record<string, number> = { Seg: 0, Ter: 0, Qua: 0, Qui: 0, Sex: 0 };
    const faltasPorDiaSemana: Record<string, number> = { Seg: 0, Ter: 0, Qua: 0, Qui: 0, Sex: 0 };
    const diasNomes = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

    const sessoesPorData = new Map<string, Record<string, RegistroPresencaItem>>();

    historicoChamadas.forEach((docChamada) => {
      const anoDoc = String(docChamada.anoLetivo || ANO_LETIVO_OPERACAO);
      if (anoDoc !== ANO_LETIVO_OPERACAO) return;
      if (docChamada.id === docIdAtual) return;
      if (docChamada.data && docChamada.registros && typeof docChamada.registros === 'object') {
        sessoesPorData.set(String(docChamada.data), docChamada.registros);
      }
    });

    if (Object.keys(registrosPresenca).length > 0) {
      sessoesPorData.set(dataSelecionada, registrosPresenca);
    }

    const datasOrdenadasDesc = Array.from(sessoesPorData.keys()).sort((a, b) => b.localeCompare(a));

    let totalAtrasosHistorico = 0;
    let totalFaltasHistorico = 0;
    let totalLicencasHistorico = 0;

    datasOrdenadasDesc.forEach((dataIso) => {
      const registros = sessoesPorData.get(dataIso) || {};
      const dt = new Date(`${dataIso}T12:00:00`);
      const diaLabel = !isNaN(dt.getTime()) ? diasNomes[dt.getDay()] : '';

      Object.entries(registros).forEach(([raRaw, info]) => {
        const raKey = normalizarRaChave(raRaw);
        if (!raKey) return;
        if (!mapaPorRa[raKey]) {
          mapaPorRa[raKey] = {
            faltasDiario: 0,
            licencasDiario: 0,
            datasLicencaRegistradas: new Set<string>(),
            atrasosDiario: 0,
            datasAtrasoRegistradas: new Set<string>(),
            faltasConsecutivas: 0
          };
        }
        const st = info?.status || 'presente';
        if (st === 'falta') {
          mapaPorRa[raKey].faltasDiario++;
          totalFaltasHistorico++;
          if (diaLabel && faltasPorDiaSemana[diaLabel] !== undefined) faltasPorDiaSemana[diaLabel]++;
        } else if (st === 'licenca') {
          mapaPorRa[raKey].licencasDiario++;
          mapaPorRa[raKey].datasLicencaRegistradas.add(dataIso);
          totalLicencasHistorico++;
        } else if (st === 'atrasado') {
          mapaPorRa[raKey].atrasosDiario++;
          mapaPorRa[raKey].datasAtrasoRegistradas.add(dataIso);
          totalAtrasosHistorico++;
          if (diaLabel && atrasosPorDiaSemana[diaLabel] !== undefined) atrasosPorDiaSemana[diaLabel]++;
        }
      });
    });

    Object.keys(mapaPorRa).forEach((raKey) => {
      let seq = 0;
      for (const dataIso of datasOrdenadasDesc) {
        const reg = sessoesPorData.get(dataIso)?.[raKey];
        if (!reg) continue;
        if (reg.status === 'falta') seq++;
        else break;
      }
      mapaPorRa[raKey].faltasConsecutivas = seq;
    });

    let diaSemanaMaisCritico = 'Sem dados';
    let maxOcorrenciasDia = 0;
    (['Seg', 'Ter', 'Qua', 'Qui', 'Sex'] as const).forEach((d) => {
      const soma = (atrasosPorDiaSemana[d] || 0) + (faltasPorDiaSemana[d] || 0);
      if (soma > maxOcorrenciasDia) {
        maxOcorrenciasDia = soma;
        diaSemanaMaisCritico = `${d} (${atrasosPorDiaSemana[d] || 0} atrasos, ${faltasPorDiaSemana[d] || 0} faltas)`;
      }
    });

    const alertasConsecutivos = Object.values(mapaPorRa).filter((v) => v.faltasConsecutivas >= 2).length;

    return {
      mapaPorRa,
      resumo: {
        diasRegistrados: datasOrdenadasDesc.length,
        totalAtrasosHistorico,
        totalFaltasHistorico,
        totalLicencasHistorico,
        atrasosPorDiaSemana,
        faltasPorDiaSemana,
        diaSemanaMaisCritico,
        alertasConsecutivos
      }
    };
  }, [historicoChamadas, registrosPresenca, dataSelecionada]);

  // 12. Montagem da lista enriquecida: ordenação estrita por TURMA -> ALFABÉTICA, cruzando Dispensas + Atrasos
  const listaAlunosEnriquecida: AlunoPresenca[] = useMemo(() => {
    const lista = alunosBase.map((a) => {
      const raKey = normalizarRaChave(a.ra || a.id);
      const regSalvo = registrosPresenca[raKey];

      const dispensasDoAluno = integracaoCruzada.dispensasPorRa[raKey] || [];
      const dispensaAtiva = dispensasDoAluno.find(
        (d) => dataSelecionada >= d.dataInicio && dataSelecionada <= d.dataFim
      ) || null;
      const atrasoOcorrencia = integracaoCruzada.atrasosDiaPorRa[raKey] || null;

      let statusEfetivo: StatusPresenca = 'presente';
      let origem: OrigemRegistro = 'pendente';
      let verificado = false;
      let horarioAtraso = '';
      let motivoLicenca = '';

      if (regSalvo?.manualOverride) {
        statusEfetivo = regSalvo.status;
        origem = regSalvo.origem || 'manual';
        verificado = true;
        horarioAtraso = regSalvo.horarioAtraso || (atrasoOcorrencia?.horario ?? '');
        motivoLicenca = regSalvo.motivoLicenca || (dispensaAtiva?.motivo ?? '');
      } else if (dispensaAtiva) {
        statusEfetivo = 'licenca';
        origem = 'dispensa';
        verificado = true;
        motivoLicenca = dispensaAtiva.motivo;
      } else if (atrasoOcorrencia) {
        statusEfetivo = 'atrasado';
        origem = 'atraso_ocorrencia';
        verificado = true;
        horarioAtraso = atrasoOcorrencia.horario;
      } else if (regSalvo) {
        statusEfetivo = regSalvo.status || 'presente';
        origem = regSalvo.origem || 'manual';
        verificado = Boolean(regSalvo.verificado);
        horarioAtraso = regSalvo.horarioAtraso || '';
        motivoLicenca = regSalvo.motivoLicenca || '';
      }

      const hist = historicoAgregado.mapaPorRa[raKey] || {
        faltasDiario: 0,
        licencasDiario: 0,
        datasLicencaRegistradas: new Set<string>(),
        atrasosDiario: 0,
        datasAtrasoRegistradas: new Set<string>(),
        faltasConsecutivas: 0
      };

      const diasDispensaSet = integracaoCruzada.diasDispensaLetivosPorRa[raKey] || new Set<string>();
      let dispensasExtrasNaoDuplicadas = 0;
      diasDispensaSet.forEach((ymd) => {
        const ehHojeDispensaAuto = ymd === dataSelecionada && statusEfetivo === 'licenca' && !regSalvo;
        if (!hist.datasLicencaRegistradas.has(ymd) && !ehHojeDispensaAuto) {
          dispensasExtrasNaoDuplicadas++;
        }
      });

      const hojeAutoLicenca = statusEfetivo === 'licenca' && !regSalvo ? 1 : 0;
      const hojeAutoAtraso = statusEfetivo === 'atrasado' && !regSalvo ? 1 : 0;

      const faltasBase = Number(a.total_faltas || a.faltas || a.faltas_acumuladas || 0);
      const licencasBase = Number(
        a.licencas_afastamentos || a.atestados_dias || (a.justificativas ? a.justificativas.length : 0)
      );
      const ajusteExtraLicenca = Number(licencasAjuste[raKey] || 0);
      const atrasosBase = Number(a.atrasos || a.total_atrasos || 0);
      const atrasosOcorrTotal = integracaoCruzada.atrasosCountOcorrenciasPorRa[raKey] || 0;

      const faltasTotais = faltasBase + hist.faltasDiario + hist.licencasDiario + hojeAutoLicenca;
      const licencasAfastamentos = Math.max(
        0,
        licencasBase + hist.licencasDiario + hojeAutoLicenca + dispensasExtrasNaoDuplicadas + ajusteExtraLicenca
      );
      const faltasEfetivas = Math.max(0, faltasTotais - licencasAfastamentos);

      const atrasosAcumulados = Math.max(atrasosBase + hist.atrasosDiario + hojeAutoAtraso, atrasosOcorrTotal);

      const tutor = String(a.tutor_2027 || a.tutor || a.tutor_2026 || 'Não atribuído').trim();

      return {
        id: a.id || raKey,
        ra: raKey,
        nome: String(a.nome || 'Estudante').trim().toUpperCase(),
        turma: String(a.turma || 'SEM TURMA').trim().toUpperCase(),
        tutor,
        telefone: a.telefone || a.contato || a.fone_responsavel || '',
        status: statusEfetivo,
        verificado,
        origem,
        horarioAtraso,
        motivoLicenca,
        dispensaAtiva,
        atrasoOcorrencia,
        faltasTotais,
        licencasAfastamentos,
        faltasEfetivas,
        atrasosAcumulados,
        faltasConsecutivas: hist.faltasConsecutivas
      };
    });

    // Ordenação estrita: 1º por Turma, 2º Ordem Alfabética pelo Nome
    return lista.sort((a, b) => {
      const cmpT = compararTurmas(a.turma, b.turma);
      if (cmpT !== 0) return cmpT;
      return a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' });
    });
  }, [alunosBase, registrosPresenca, integracaoCruzada, dataSelecionada, historicoAgregado, licencasAjuste]);

  // Progresso por turma para "Salvar e Continuar Depois"
  const progressoPorTurma = useMemo(() => {
    const mapa: Record<string, { turma: string; total: number; verificados: number; concluidosPorcentagem: number; estado: 'concluida' | 'em_andamento' | 'pendente' }> = {};
    listaAlunosEnriquecida.forEach((al) => {
      if (!mapa[al.turma]) {
        mapa[al.turma] = { turma: al.turma, total: 0, verificados: 0, concluidosPorcentagem: 0, estado: 'pendente' };
      }
      mapa[al.turma].total++;
      if (al.verificado) mapa[al.turma].verificados++;
    });

    return Object.values(mapa)
      .map((item) => {
        const pct = item.total > 0 ? Math.round((item.verificados / item.total) * 100) : 0;
        const estado: 'concluida' | 'em_andamento' | 'pendente' =
          item.verificados >= item.total && item.total > 0
            ? 'concluida'
            : item.verificados > 0
            ? 'em_andamento'
            : 'pendente';
        return { ...item, concluidosPorcentagem: pct, estado };
      })
      .sort((a, b) => compararTurmas(a.turma, b.turma));
  }, [listaAlunosEnriquecida]);

  const resumoProgressoDia = useMemo(() => {
    const totalTurmas = progressoPorTurma.length;
    const turmasConcluidas = progressoPorTurma.filter((t) => t.estado === 'concluida').length;
    const totalAlunos = listaAlunosEnriquecida.length;
    const verificadosAlunos = listaAlunosEnriquecida.filter((a) => a.verificado).length;
    return { totalTurmas, turmasConcluidas, totalAlunos, verificadosAlunos };
  }, [progressoPorTurma, listaAlunosEnriquecida]);

  // Filtros aplicados mantendo ordenação Turma -> Alfabética
  const alunosFiltrados = useMemo(() => {
    return listaAlunosEnriquecida.filter((a) => {
      if (turmaSelecionada !== 'TODAS' && a.turma !== turmaSelecionada.toUpperCase()) {
        return false;
      }
      if (filtroStatus === 'PENDENTE') {
        if (a.verificado) return false;
      } else if (filtroStatus !== 'TODOS' && a.status !== filtroStatus) {
        return false;
      }
      if (filtroBusca.trim()) {
        const termo = filtroBusca.toLowerCase().trim();
        const textoBusca = `${a.nome} ${a.ra} ${a.turma} ${a.tutor}`.toLowerCase();
        if (!textoBusca.includes(termo)) return false;
      }
      return true;
    });
  }, [listaAlunosEnriquecida, turmaSelecionada, filtroStatus, filtroBusca]);

  // Agrupamento visual por Turma (cada grupo já vem ordenado alfabeticamente)
  const gruposPorTurma = useMemo(() => {
    const map = new Map<string, AlunoPresenca[]>();
    alunosFiltrados.forEach((al) => {
      if (!map.has(al.turma)) map.set(al.turma, []);
      map.get(al.turma)!.push(al);
    });
    return Array.from(map.entries()).map(([turma, alunos]) => {
      const prog = progressoPorTurma.find((p) => p.turma === turma);
      return {
        turma,
        alunos,
        totalTurma: prog?.total ?? alunos.length,
        verificadosTurma: prog?.verificados ?? alunos.filter((x) => x.verificado).length,
        estadoTurma: prog?.estado ?? 'pendente'
      };
    });
  }, [alunosFiltrados, progressoPorTurma]);

  // Estatísticas globais ou da turma selecionada
  const estatisticas = useMemo(() => {
    const base =
      turmaSelecionada === 'TODAS'
        ? listaAlunosEnriquecida
        : listaAlunosEnriquecida.filter((a) => a.turma === turmaSelecionada.toUpperCase());
    const total = base.length;
    let presentes = 0;
    let atrasados = 0;
    let faltosos = 0;
    let licencas = 0;

    let somaFaltasTotais = 0;
    let somaLicencas = 0;
    let somaFaltasEfetivas = 0;

    base.forEach((a) => {
      if (a.status === 'presente') presentes++;
      else if (a.status === 'atrasado') atrasados++;
      else if (a.status === 'falta') faltosos++;
      else if (a.status === 'licenca') licencas++;

      somaFaltasTotais += a.faltasTotais;
      somaLicencas += a.licencasAfastamentos;
      somaFaltasEfetivas += a.faltasEfetivas;
    });

    const taxaPresenca = total > 0 ? (((presentes + atrasados) / total) * 100).toFixed(1) : '100.0';

    return {
      total,
      presentes,
      atrasados,
      faltosos,
      licencas,
      taxaPresenca,
      somaFaltasTotais,
      somaLicencas,
      somaFaltasEfetivas
    };
  }, [listaAlunosEnriquecida, turmaSelecionada]);

  // Ação: Alterar status individual
  const handleAlterarStatus = (
    ra: string,
    novoStatus: StatusPresenca,
    extras?: { horarioAtraso?: string; motivoLicenca?: string }
  ) => {
    if (!podeLancarNoDia) {
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast(
          'Este dia consta sem aulas na Agenda PEI. Habilite chamada extraordinária se desejar registrar.',
          'warning'
        );
      }
      return;
    }

    registrosEditadosLocalmenteRef.current = true;
    const al = listaAlunosEnriquecida.find((x) => x.ra === ra);

    setRegistrosPresenca((prev) => ({
      ...prev,
      [ra]: {
        status: novoStatus,
        horarioAtraso:
          novoStatus === 'atrasado'
            ? extras?.horarioAtraso ?? prev[ra]?.horarioAtraso ?? al?.horarioAtraso ?? '07:15'
            : undefined,
        motivoLicenca:
          novoStatus === 'licenca'
            ? extras?.motivoLicenca ?? prev[ra]?.motivoLicenca ?? al?.motivoLicenca ?? 'Atestado Médico'
            : undefined,
        verificado: true,
        manualOverride: true,
        origem: 'manual',
        atualizadoEm: new Date().toISOString()
      }
    }));
  };

  // Ação: Confirmar estudantes restantes de UMA turma específica como Presentes (mantendo Dispensas e Atrasos)
  const handleConfirmarTurmaPresentes = (turmaAlvo: string) => {
    if (!podeLancarNoDia) return;
    registrosEditadosLocalmenteRef.current = true;

    const alunosDaTurma = listaAlunosEnriquecida.filter((a) => a.turma === turmaAlvo);
    const agoraIso = new Date().toISOString();
    let qtdConfirmados = 0;

    setRegistrosPresenca((prev) => {
      const next = { ...prev };
      alunosDaTurma.forEach((a) => {
        if (a.dispensaAtiva) {
          next[a.ra] = {
            status: 'licenca',
            motivoLicenca: a.dispensaAtiva.motivo,
            verificado: true,
            manualOverride: false,
            origem: 'dispensa',
            atualizadoEm: agoraIso
          };
          return;
        }
        if (a.atrasoOcorrencia) {
          next[a.ra] = {
            status: 'atrasado',
            horarioAtraso: a.atrasoOcorrencia.horario,
            verificado: true,
            manualOverride: false,
            origem: 'atraso_ocorrencia',
            atualizadoEm: agoraIso
          };
          return;
        }
        if (!next[a.ra]?.verificado) {
          next[a.ra] = {
            status: 'presente',
            verificado: true,
            manualOverride: false,
            origem: 'manual',
            atualizadoEm: agoraIso
          };
          qtdConfirmados++;
        }
      });
      return next;
    });

    if (typeof (window as any).showToast === 'function') {
      (window as any).showToast(
        `Turma ${turmaAlvo} confirmada! (${qtdConfirmados} marcados como presentes; dispensas e atrasos preservados)`,
        'success'
      );
    }
  };

  // Ação: Confirmar todos visíveis como presentes (preservando Dispensas do Dossiê e Atrasos da Portaria/Ocorrências)
  const handleMarcarTodosPresentes = () => {
    if (!podeLancarNoDia) {
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Dia não letivo na Agenda PEI. Habilite a chamada extraordinária se necessário.', 'warning');
      }
      return;
    }

    registrosEditadosLocalmenteRef.current = true;
    const agoraIso = new Date().toISOString();
    const atualizados = { ...registrosPresenca };
    let contPres = 0;
    let contPreservados = 0;

    alunosFiltrados.forEach((a) => {
      if (a.dispensaAtiva) {
        atualizados[a.ra] = {
          status: 'licenca',
          motivoLicenca: a.dispensaAtiva.motivo,
          verificado: true,
          manualOverride: false,
          origem: 'dispensa',
          atualizadoEm: agoraIso
        };
        contPreservados++;
      } else if (a.atrasoOcorrencia) {
        atualizados[a.ra] = {
          status: 'atrasado',
          horarioAtraso: a.atrasoOcorrencia.horario,
          verificado: true,
          manualOverride: false,
          origem: 'atraso_ocorrencia',
          atualizadoEm: agoraIso
        };
        contPreservados++;
      } else if (a.status === 'falta' && a.verificado) {
        // Mantém faltas já marcadas manualmente se operador já verificou
        atualizados[a.ra] = {
          ...(atualizados[a.ra] || { status: 'falta' }),
          verificado: true
        };
        contPreservados++;
      } else {
        atualizados[a.ra] = {
          status: 'presente',
          verificado: true,
          manualOverride: false,
          origem: 'manual',
          atualizadoEm: agoraIso
        };
        contPres++;
      }
    });

    setRegistrosPresenca(atualizados);
    if (typeof (window as any).showToast === 'function') {
      (window as any).showToast(
        `${contPres} estudantes confirmados como Presentes (${contPreservados} dispensas/atrasos/faltas preservados).`,
        'success'
      );
    }
  };

  // Ação: Ajuste rápido de licenças/atestados retroativos (atualiza imediatamente a 3ª métrica)
  const handleAjustarLicencaExtra = async (ra: string, delta: number, valorAtualLicencas: number) => {
    if (delta < 0 && valorAtualLicencas <= 0) return;
    const novoMapa = {
      ...licencasAjuste,
      [ra]: Number(licencasAjuste[ra] || 0) + delta
    };
    setLicencasAjuste(novoMapa);
    const ajusteKey = `licencas_ajuste_${ANO_LETIVO_OPERACAO}`;
    try {
      localStorage.setItem(`clovis_${ajusteKey}`, JSON.stringify(novoMapa));
      await setDoc(
        doc(db, 'config_escola', ajusteKey),
        {
          anoLetivo: ANO_LETIVO_OPERACAO,
          ajustes: novoMapa,
          atualizadoPor: activeUser.nome,
          atualizadoEm: new Date().toISOString()
        },
        { merge: true }
      );
    } catch (e) {
      console.warn('Erro ao salvar ajuste de licença:', e);
    }
  };

  // Ação: Salvar chamada (Parcial "Continuar Depois" OU Finalizada)
  const handleSalvarChamada = async (modo: 'parcial' | 'final' = 'final') => {
    if (!podeLancarNoDia) {
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Habilite a chamada extraordinária para salvar em dia não letivo.', 'warning');
      }
      return;
    }

    setSalvando(true);
    const docId = `chamada_${dataSelecionada}_${ANO_LETIVO_OPERACAO}`;
    const agoraIso = new Date().toISOString();

    // Consolidar registros incluindo entradas cruzadas (dispensas/atrasos) e no modo 'final' confirmar restantes da seleção
    const registrosParaSalvar: Record<string, RegistroPresencaItem> = { ...registrosPresenca };
    listaAlunosEnriquecida.forEach((a) => {
      if (!registrosParaSalvar[a.ra] && (a.dispensaAtiva || a.atrasoOcorrencia)) {
        registrosParaSalvar[a.ra] = {
          status: a.status,
          horarioAtraso: a.horarioAtraso || undefined,
          motivoLicenca: a.motivoLicenca || undefined,
          verificado: true,
          manualOverride: false,
          origem: a.origem,
          atualizadoEm: agoraIso
        };
      }
    });

    const turmasConcluidasLista = progressoPorTurma.filter((t) => t.estado === 'concluida').map((t) => t.turma);
    const statusChamada: 'em_andamento' | 'concluida' =
      modo === 'parcial' || turmasConcluidasLista.length < progressoPorTurma.length ? 'em_andamento' : 'concluida';

    const payload = {
      data: dataSelecionada,
      anoLetivo: ANO_LETIVO_OPERACAO,
      turma: turmaSelecionada,
      statusChamada,
      agendaStatusLabel: dayStatus.statusLabel,
      registros: registrosParaSalvar,
      turmasConcluidas: turmasConcluidasLista,
      resumo: estatisticas,
      atualizadoPor: activeUser.nome,
      atualizadoEm: agoraIso
    };

    try {
      const docRef = doc(db, 'frequencia_diaria', docId);
      await setDoc(docRef, payload, { merge: true });

      setRegistrosPresenca(registrosParaSalvar);
      setStatusSalvamentoDoc(statusChamada);
      registrosEditadosLocalmenteRef.current = false;

      localStorage.setItem(
        `clovis_chamada_${docId}`,
        JSON.stringify({ registros: registrosParaSalvar, statusChamada, atualizadoEm: agoraIso })
      );

      const dt = new Date(agoraIso);
      setUltimoSalvamentoTexto(
        `Salvo em ${dt.toLocaleDateString('pt-BR')} às ${dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · ${activeUser.nome}`
      );

      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast(
          modo === 'parcial'
            ? `Progresso salvo (${turmasConcluidasLista.length}/${progressoPorTurma.length} turmas concluídas). Você pode retomar depois!`
            : 'Chamada diária salva e sincronizada com o banco de dados!',
          'success'
        );
      }
    } catch (err) {
      console.error('Erro ao salvar chamada:', err);
      localStorage.setItem(
        `clovis_chamada_${docId}`,
        JSON.stringify({ registros: registrosParaSalvar, statusChamada, atualizadoEm: agoraIso })
      );
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Progresso salvo localmente para você continuar depois.', 'info');
      }
    } finally {
      setSalvando(false);
    }
  };

  // LGPD: primeiro nome (ou inicial se repetido na turma)
  const formatarNomeLgpd = useCallback(
    (nomeCompleto: string, turmaRef: string): string => {
      const limpo = (nomeCompleto || '').trim();
      if (!limpo) return 'Estudante';
      const partes = limpo.split(/\s+/);
      const primeiroNome = partes[0] || limpo;

      const colegasNaTurma = alunosBase.filter(
        (a) => String(a.turma || '').trim().toUpperCase() === turmaRef.toUpperCase()
      );
      const repetidos = colegasNaTurma.filter((a) => {
        const p = String(a.nome || '').trim().split(/\s+/)[0];
        return p.toLowerCase() === primeiroNome.toLowerCase();
      });

      if (repetidos.length > 1 && partes.length > 1) {
        const sobrenomeInicial = partes[1].charAt(0).toUpperCase();
        return `${primeiroNome} ${sobrenomeInicial}.`;
      }
      return primeiroNome;
    },
    [alunosBase]
  );

  // Mensagem para os pais com IA + LGPD
  const handleGerarMensagemWhatsapp = async (tomOverride?: 'acolhedor' | 'padrao' | 'urgente') => {
    const tomAtivo = tomOverride || tomComunicado;
    if (tomOverride) setTomComunicado(tomOverride);
    setGerandoMensagemIa(true);
    setModalWhatsappAberto(true);

    const faltososPorTurma: Record<string, string[]> = {};
    const atrasadosPorTurma: Record<string, string[]> = {};
    const faltasConsecutivasAlerta: { turma: string; dias: number }[] = [];

    listaAlunosEnriquecida.forEach((a) => {
      if (turmaSelecionada !== 'TODAS' && a.turma !== turmaSelecionada.toUpperCase()) return;

      const t = a.turma;
      if (a.status === 'falta') {
        faltososPorTurma[t] = faltososPorTurma[t] || [];
        faltososPorTurma[t].push(formatarNomeLgpd(a.nome, t));
        if (a.faltasConsecutivas >= 2) {
          faltasConsecutivasAlerta.push({ turma: t, dias: a.faltasConsecutivas });
        }
      } else if (a.status === 'atrasado') {
        atrasadosPorTurma[t] = atrasadosPorTurma[t] || [];
        const hr = a.horarioAtraso ? ` (${a.horarioAtraso})` : '';
        atrasadosPorTurma[t].push(`${formatarNomeLgpd(a.nome, t)}${hr}`);
      }
    });

    const gerarModeloLocal = () => {
      const dataFormatada = formatarDataBr(dataSelecionada);
      let msg = `*EE PROF. CLÓVIS DE LUCCA - PROGRAMA ENSINO INTEGRAL*\n`;
      msg += `📋 *BOLETIM DIÁRIO DE FREQUÊNCIA - ${dataFormatada}*\n`;
      msg += `Ano Letivo ${ANO_LETIVO_OPERACAO} • Comunicação aos Responsáveis\n\n`;

      msg += `🚫 *ESTUDANTES AUSENTES NO DIA*\n`;
      const turmasFaltosas = Object.keys(faltososPorTurma).sort(compararTurmas);
      if (turmasFaltosas.length === 0) {
        msg += `• Nenhuma ausência injustificada registrada no período.\n\n`;
      } else {
        turmasFaltosas.forEach((t) => {
          msg += `• *${t}*: ${faltososPorTurma[t].join(', ')}.\n`;
        });
        msg += `\n`;
      }

      msg += `⏰ *ENTRADAS TARDIAS / ATRASOS*\n`;
      const turmasAtrasadas = Object.keys(atrasadosPorTurma).sort(compararTurmas);
      if (turmasAtrasadas.length === 0) {
        msg += `• Sem atrasos registrados na entrada.\n\n`;
      } else {
        turmasAtrasadas.forEach((t) => {
          msg += `• *${t}*: ${atrasadosPorTurma[t].join(', ')}.\n`;
        });
        msg += `\n`;
      }

      msg += `📊 *BALANÇO GERAL DO DIA*\n`;
      msg += `• Total de Estudantes: ${estatisticas.total}\n`;
      msg += `• Presentes em Aula: ${estatisticas.presentes + estatisticas.atrasados} (${estatisticas.taxaPresenca}% de presença)\n`;
      msg += `• Faltas Injustificadas: ${estatisticas.faltosos}\n`;
      if (estatisticas.licencas > 0) {
        msg += `• Dispensas / Afastamentos Justificados: ${estatisticas.licencas}\n`;
      }
      msg += `\n⚠️ *ORIENTAÇÃO AOS PAIS E RESPONSÁVEIS:*\n`;
      msg += `A frequência e pontualidade diárias no Programa Ensino Integral (PEI) são fundamentais para o aproveitamento pedagógico. Caso haja justificativa médica para a ausência, favor encaminhar o atestado à Secretaria Escolar.\n\n`;
      msg += `Atenciosamente,\n*Equipe Gestora & Coordenação Pedagógica*\nEE Prof. Clóvis de Lucca`;
      return msg;
    };

    try {
      const res = await fetch('/api/ai/mensagem-faltosos-dia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: dataSelecionada,
          anoLetivo: ANO_LETIVO_OPERACAO,
          turma: turmaSelecionada,
          estatisticas,
          faltososPorTurma,
          atrasadosPorTurma,
          faltasConsecutivasAlerta,
          tomComunicado: tomAtivo
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const dataJson = await res.json();
      if (dataJson?.mensagem) {
        setTextoMensagemWhatsapp(dataJson.mensagem);
        setOrigemMensagemIa(dataJson.origem === 'gemini' ? 'gemini' : 'fallback');
      } else {
        setTextoMensagemWhatsapp(gerarModeloLocal());
        setOrigemMensagemIa('fallback');
      }
    } catch {
      setTextoMensagemWhatsapp(gerarModeloLocal());
      setOrigemMensagemIa('fallback');
    } finally {
      setGerandoMensagemIa(false);
    }
  };

  // Mapeamento comportamental IA 2027
  const handleExecutarAnaliseIa = async () => {
    setGerandoAnaliseIa(true);
    setModalIaAnaliseAberto(true);

    const amostraPriorizada = [...listaAlunosEnriquecida]
      .sort((a, b) => {
        const pesoA = (a.status === 'falta' ? 40 : a.status === 'atrasado' ? 25 : 0) + a.faltasConsecutivas * 20 + a.faltasEfetivas + a.atrasosAcumulados * 3;
        const pesoB = (b.status === 'falta' ? 40 : b.status === 'atrasado' ? 25 : 0) + b.faltasConsecutivas * 20 + b.faltasEfetivas + b.atrasosAcumulados * 3;
        return pesoB - pesoA;
      })
      .slice(0, 80);

    try {
      const res = await fetch('/api/ai/analise-comportamental-2027', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          turma: turmaSelecionada,
          dataReferencia: dataSelecionada,
          anoLetivoAlvo: ANO_LETIVO_OPERACAO,
          estatisticas,
          historicoResumo: historicoAgregado.resumo,
          chamadaHoje: amostraPriorizada
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const resJson = await res.json();
      if (resJson.data) setAnaliseIaDados(resJson.data);
    } catch {
      setAnaliseIaDados({
        diagnosticoGeral: `Diagnóstico de Frequência 2027 para ${turmaSelecionada} em ${formatarDataBr(dataSelecionada)}: Taxa de presença em ${estatisticas.taxaPresenca}% (${historicoAgregado.resumo.diasRegistrados} dia(s) apurado(s)). A 3ª métrica isolou ${estatisticas.somaFaltasEfetivas} faltas efetivas reais após descontar dispensas e licenças.`,
        padroesDetectados: [
          {
            titulo: 'Pontualidade na 1ª Aula (07:00)',
            descricao: `Atrasos concentrados na entrada matinal. Dia mais crítico observado: ${historicoAgregado.resumo.diaSemanaMaisCritico}.`,
            grau: 'ALTO',
            alunosImpactados: estatisticas.atrasados || 1
          },
          {
            titulo: 'Expurgo Automático de Dispensas Legais',
            descricao: 'Dispensas registradas em Ocorrências e Dossiê já são descontadas na 3ª métrica, evitando falsos alertas na Busca Ativa.',
            grau: 'MODERADO',
            alunosImpactados: estatisticas.licencas || 0
          }
        ],
        analiseTerceiraMetrica: {
          explicacao: 'A 3ª Métrica subtrai automaticamente atestados médicos, licenças e dispensas registradas em Dossiê/Ocorrências das faltas brutas.',
          totalFaltasBrutas: estatisticas.somaFaltasTotais,
          totalLicencasAfastamentos: estatisticas.somaLicencas,
          totalFaltasEfetivas: estatisticas.somaFaltasEfetivas,
          conclusaoPedagogica: 'Priorizar Busca Ativa e Tutoria nos estudantes com maior saldo de faltas efetivas reais.'
        },
        projecaoRisco2027: amostraPriorizada
          .filter((a) => a.status === 'falta' || a.atrasosAcumulados >= 3 || a.faltasEfetivas >= 8)
          .slice(0, 6)
          .map((a) => ({
            ra: a.ra,
            nome: a.nome,
            turma: a.turma,
            nivelRisco: a.faltasEfetivas >= 12 ? 'CRÍTICO' : 'ATENÇÃO',
            motivo: `${a.faltasEfetivas} faltas efetivas e ${a.atrasosAcumulados} atrasos acumulados.`,
            acaoTutoria2027: 'Pactuar meta de assiduidade e pontualidade com Tutor PEI e responsáveis.'
          })),
        acoesImediatas: [
          {
            prioridade: 'IMEDIATA',
            titulo: 'Envio do Boletim Diário aos Pais',
            descricao: 'Comunicar responsáveis dos estudantes ausentes/atrasados com o texto gerado pela IA em conformidade LGPD.',
            responsavel: 'Secretaria / Equipe Gestora'
          },
          {
            prioridade: 'SEMANAL',
            titulo: 'Pauta de Tutoria PEI',
            descricao: 'Acionar Tutores dos estudantes com atrasos ou faltas efetivas recorrentes para acolhimento.',
            responsavel: 'CGPG e Tutores'
          }
        ]
      });
    } finally {
      setGerandoAnaliseIa(false);
    }
  };

  const handleCopiarMensagem = () => {
    if (!textoMensagemWhatsapp) return;
    navigator.clipboard.writeText(textoMensagemWhatsapp);
    if (typeof (window as any).showToast === 'function') {
      (window as any).showToast('Mensagem copiada para a área de transferência!', 'success');
    }
  };

  const whatsappWebUrl = useMemo(() => {
    if (!textoMensagemWhatsapp) return 'https://web.whatsapp.com/';
    return `https://web.whatsapp.com/send?text=${encodeURIComponent(textoMensagemWhatsapp)}`;
  }, [textoMensagemWhatsapp]);

  return (
    <div className="w-full min-h-screen bg-slate-50 text-slate-800 p-4 sm:p-6 lg:p-8 space-y-5">
      {/* ============================================================== */}
      {/* CABEÇALHO DO MÓDULO (OPERACIONAL 2027 SEM TRANSIÇÃO)            */}
      {/* ============================================================== */}
      <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200 flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-slate-900 text-cyan-300 flex items-center justify-center text-xl shrink-0">
            <i className="fa-solid fa-clipboard-user"></i>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-semibold">
              <span className="text-slate-900 font-bold">Ano Letivo 2027</span>
              <span aria-hidden="true">·</span>
              <span>Ordenado por Turma e Ordem Alfabética</span>
              {ultimoSalvamentoTexto && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-emerald-700 font-bold tabular-nums">{ultimoSalvamentoTexto}</span>
                </>
              )}
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 mt-0.5 tracking-tight">
              Presença Diária & Monitoramento Comportamental 2027
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Integrado à Agenda PEI, Dispensas do Dossiê/Ocorrências e Atrasos em tempo real, com cálculo automático da 3ª Métrica.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto shrink-0">
          <button
            type="button"
            onClick={handleMarcarTodosPresentes}
            disabled={!podeLancarNoDia}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            title="Confirma restantes como presentes preservando dispensas e atrasos já lançados"
          >
            <i className="fa-solid fa-check-double text-xs"></i>
            <span>Confirmar Restantes Presentes</span>
          </button>

          <button
            type="button"
            onClick={() => handleGerarMensagemWhatsapp()}
            className="px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <i className="fa-brands fa-whatsapp text-sm"></i>
            <span>Mensagem Pais (IA)</span>
          </button>

          <button
            type="button"
            onClick={handleExecutarAnaliseIa}
            className="px-3.5 py-2 bg-indigo-700 hover:bg-indigo-800 text-white text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <i className="fa-solid fa-brain text-xs"></i>
            <span>Análise IA 2027</span>
          </button>

          <button
            type="button"
            onClick={() => handleSalvarChamada('parcial')}
            disabled={salvando || !podeLancarNoDia}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-900 border border-slate-300 text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
            title="Salva o andamento parcial das turmas já conferidas para continuar depois"
          >
            <i className="fa-solid fa-bookmark text-xs text-blue-700"></i>
            <span>Salvar e Continuar Depois</span>
          </button>

          <button
            type="button"
            onClick={() => handleSalvarChamada('final')}
            disabled={salvando || !podeLancarNoDia}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            <i className={`fa-solid ${salvando ? 'fa-spinner animate-spin text-cyan-400' : 'fa-floppy-disk text-cyan-400'} text-xs`}></i>
            <span>{salvando ? 'Salvando...' : 'Salvar Chamada'}</span>
          </button>
        </div>
      </div>

      {/* ============================================================== */}
      {/* SINCRONIZAÇÃO COM AGENDA PEI (DIAS LETIVOS VS NÃO LETIVOS)     */}
      {/* ============================================================== */}
      <div
        className={`rounded-2xl p-4 border flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 ${
          dayStatus.hasFeriado
            ? 'bg-rose-50 border-rose-300 text-rose-950'
            : dayStatus.isWeekend && !dayStatus.hasReposicao
            ? 'bg-slate-100 border-slate-300 text-slate-800'
            : dayStatus.hasReposicao
            ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
            : dayStatus.hasProvao
            ? 'bg-purple-50 border-purple-300 text-purple-950'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        <div className="flex items-start sm:items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center text-base shrink-0 ${
              dayStatus.isLetivo ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
            }`}
          >
            <i className={`fa-solid ${dayStatus.isLetivo ? 'fa-calendar-check' : 'fa-calendar-xmark'}`}></i>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-bold">Agenda PEI · {formatarDataBr(dataSelecionada)}</span>
              <span aria-hidden="true">/</span>
              <span className="font-black">{dayStatus.statusLabel}</span>
            </div>
            {eventosDoDiaAgenda.length > 0 ? (
              <p className="text-[11px] opacity-85 mt-0.5">
                Eventos na Agenda PEI:{' '}
                {eventosDoDiaAgenda.map((ev) => `${ev.titulo || ev.categoria} (${ev.categoria})`).join(' · ')}
              </p>
            ) : (
              <p className="text-[11px] opacity-75 mt-0.5">
                {dayStatus.isLetivo
                  ? 'Dia letivo habilitado pela Agenda PEI. Dispensas com datas e atrasos são cruzados automaticamente.'
                  : 'Pela Agenda PEI não há aula regular nesta data (sábado/domingo/feriado/recesso). Navegue para o próximo dia letivo.'}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => handleNavegarDiaLetivo(-1)}
            className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-bold rounded-lg transition cursor-pointer whitespace-nowrap"
          >
            ← Dia Letivo Anterior
          </button>
          <button
            type="button"
            onClick={() => setDataSelecionada(hojeIso)}
            className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-bold rounded-lg transition cursor-pointer whitespace-nowrap"
          >
            Hoje
          </button>
          <button
            type="button"
            onClick={() => handleNavegarDiaLetivo(1)}
            className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-bold rounded-lg transition cursor-pointer whitespace-nowrap"
          >
            Próximo Dia Letivo →
          </button>
          {!dayStatus.isLetivo && (
            <button
              type="button"
              onClick={() => setForcarChamadaDiaNaoLetivo((v) => !v)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition cursor-pointer whitespace-nowrap ${
                forcarChamadaDiaNaoLetivo
                  ? 'bg-rose-700 text-white border-rose-700'
                  : 'bg-white text-rose-800 border-rose-300 hover:bg-rose-100'
              }`}
            >
              {forcarChamadaDiaNaoLetivo ? 'Chamada Extraordinária Ativa' : 'Liberar Chamada Extraordinária'}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (typeof (window as any).clovisSwitchView === 'function') {
                (window as any).clovisSwitchView('agenda');
              }
            }}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg transition cursor-pointer whitespace-nowrap"
          >
            Ver Agenda PEI
          </button>
        </div>
      </div>

      {/* ============================================================== */}
      {/* CARDS DAS 3 MÉTRICAS DE FALTAS (FALTAS EFETIVAS EM DESTAQUE)   */}
      {/* ============================================================== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-slate-200 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500">
            <span>Taxa de Presença no Dia</span>
            <i className="fa-solid fa-user-check text-emerald-600"></i>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2 tabular-nums">
              <span className="text-3xl font-black text-slate-900">{estatisticas.taxaPresenca}%</span>
              <span className="text-xs font-bold text-slate-500">
                ({estatisticas.presentes + estatisticas.atrasados} / {estatisticas.total})
              </span>
            </div>
            <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mt-2">
              <div
                className="bg-emerald-600 h-full transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(0, Number(estatisticas.taxaPresenca)))}%` }}
              ></div>
            </div>
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 mt-2 tabular-nums">
              <span>Presentes: {estatisticas.presentes}</span>
              <span className="text-amber-700">Atrasos: {estatisticas.atrasados}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500">
            <span>1ª Métrica · Faltas Brutas</span>
            <i className="fa-solid fa-list-ol text-slate-500"></i>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2 tabular-nums">
              <span className="text-3xl font-black text-slate-900">{estatisticas.faltosos}</span>
              <span className="text-xs font-bold text-slate-500">faltas hoje</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
              Total bruto acumulado: <strong>{estatisticas.somaFaltasTotais}</strong>
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-bold text-blue-700">
            <span>2ª Métrica · Dispensas & Licenças</span>
            <i className="fa-solid fa-notes-medical text-blue-600"></i>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2 tabular-nums">
              <span className="text-3xl font-black text-blue-900">{estatisticas.licencas}</span>
              <span className="text-xs font-bold text-blue-700">afastados hoje</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
              Total justificado (Dossiê/Diário): <strong>{estatisticas.somaLicencas}</strong> dia(s)
            </p>
          </div>
        </div>

        <div className="bg-rose-50/70 rounded-2xl p-5 border border-rose-300 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-bold text-rose-900">
            <span>3ª Métrica · Faltas Efetivas Reais</span>
            <i className="fa-solid fa-triangle-exclamation text-rose-600"></i>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2 tabular-nums">
              <span className="text-3xl font-black text-rose-950">{estatisticas.somaFaltasEfetivas}</span>
              <span className="text-xs font-bold text-rose-800">sem licenças/dispensas</span>
            </div>
            <p className="text-[11px] text-rose-900 mt-1 leading-snug">
              Desconsidera licenças e dispensas do Dossiê para orientar a Busca Ativa e Tutoria.
            </p>
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* PROGRESSO POR TURMA (SALVAR E CONTINUAR DEPOIS)                */}
      {/* ============================================================== */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-black text-slate-900">Progresso da Chamada por Turma</span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span className="font-bold text-slate-600 tabular-nums">
              {resumoProgressoDia.turmasConcluidas}/{resumoProgressoDia.totalTurmas} turmas concluídas ({resumoProgressoDia.verificadosAlunos}/{resumoProgressoDia.totalAlunos} estudantes verificados)
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-bold">
            <span className={statusSalvamentoDoc === 'concluida' ? 'text-emerald-700' : 'text-amber-700'}>
              {statusSalvamentoDoc === 'concluida'
                ? 'Chamada Concluída'
                : statusSalvamentoDoc === 'em_andamento'
                ? 'Em Andamento (Retomável)'
                : 'Aguardando Confirmação'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setTurmaSelecionada('TODAS')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer whitespace-nowrap ${
              turmaSelecionada === 'TODAS'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            Todas ({listaAlunosEnriquecida.length})
          </button>
          {progressoPorTurma.map((p) => {
            const ativo = turmaSelecionada === p.turma;
            const estadoClasses = ativo
              ? 'bg-slate-900 text-white border-slate-900'
              : p.estado === 'concluida'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100'
              : p.estado === 'em_andamento'
              ? 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100';

            return (
              <button
                key={p.turma}
                type="button"
                onClick={() => setTurmaSelecionada(p.turma)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition cursor-pointer flex items-center gap-1.5 tabular-nums whitespace-nowrap ${estadoClasses}`}
              >
                <span>{p.turma}</span>
                <span className="opacity-75">
                  {p.verificados}/{p.total}
                </span>
                {p.estado === 'concluida' && <i className="fa-solid fa-check text-[10px]"></i>}
              </button>
            );
          })}
        </div>
      </div>

      {/* ============================================================== */}
      {/* BARRA DE FILTROS & PESQUISA                                    */}
      {/* ============================================================== */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
          <div className="flex items-center gap-2">
            <label htmlFor="inputDataChamada" className="text-xs font-bold text-slate-600">
              Data:
            </label>
            <input
              type="date"
              id="inputDataChamada"
              value={dataSelecionada}
              onChange={(e) => setDataSelecionada(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-cyan-400 cursor-pointer tabular-nums"
            />
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="selectTurmaChamada" className="text-xs font-bold text-slate-600">
              Turma:
            </label>
            <select
              id="selectTurmaChamada"
              value={turmaSelecionada}
              onChange={(e) => setTurmaSelecionada(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-cyan-400 cursor-pointer"
            >
              <option value="TODAS">Todas as Turmas ({alunosBase.length} alunos)</option>
              {listaTurmas.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="selectStatusFiltro" className="text-xs font-bold text-slate-600">
              Status:
            </label>
            <select
              id="selectStatusFiltro"
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-cyan-400 cursor-pointer"
            >
              <option value="TODOS">Todos</option>
              <option value="PENDENTE">Pendentes de Conferência</option>
              <option value="presente">Presentes</option>
              <option value="atrasado">Atrasados</option>
              <option value="falta">Faltosos Injustificados</option>
              <option value="licenca">Dispensas / Licenças</option>
            </select>
          </div>
        </div>

        <div className="relative w-full sm:w-72">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 pointer-events-none">
            <i className="fa-solid fa-magnifying-glass text-xs"></i>
          </span>
          <input
            type="text"
            placeholder="Buscar estudante, RA ou tutor..."
            value={filtroBusca}
            onChange={(e) => setFiltroBusca(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-800 placeholder-slate-400 outline-none focus:ring-2 focus:ring-cyan-400"
          />
        </div>
      </div>

      {/* ============================================================== */}
      {/* LISTA AGRUPADA POR TURMA (TURMA -> ORDEM ALFABÉTICA)          */}
      {/* ============================================================== */}
      <div className="space-y-4">
        {loading ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500 font-medium text-xs">
            <i className="fa-solid fa-spinner animate-spin text-2xl text-cyan-600 mb-2 block"></i>
            Carregando estudantes, Agenda PEI e integrações...
          </div>
        ) : gruposPorTurma.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500 font-medium text-xs">
            <i className="fa-solid fa-user-xmark text-3xl text-slate-400 mb-2 block"></i>
            Nenhum estudante localizado com os filtros selecionados.
          </div>
        ) : (
          gruposPorTurma.map((grupo) => {
            const recolhida = Boolean(turmasRecolhidas[grupo.turma]);
            const dispensasNoGrupo = grupo.alunos.filter((a) => a.status === 'licenca').length;
            const atrasosNoGrupo = grupo.alunos.filter((a) => a.status === 'atrasado').length;
            const faltasNoGrupo = grupo.alunos.filter((a) => a.status === 'falta').length;

            return (
              <div key={grupo.turma} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                {/* Cabeçalho do Grupo da Turma */}
                <div className="px-5 py-3.5 bg-slate-50/90 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() =>
                        setTurmasRecolhidas((prev) => ({ ...prev, [grupo.turma]: !prev[grupo.turma] }))
                      }
                      className="w-7 h-7 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 flex items-center justify-center cursor-pointer transition"
                      title={recolhida ? 'Expandir turma' : 'Recolher turma'}
                    >
                      <i className={`fa-solid ${recolhida ? 'fa-chevron-right' : 'fa-chevron-down'} text-xs`}></i>
                    </button>

                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-sm font-black text-slate-900">{grupo.turma}</h2>
                        <span className="text-xs text-slate-500 font-semibold tabular-nums">
                          · {grupo.verificadosTurma}/{grupo.totalTurma} verificados
                        </span>
                        <span aria-hidden="true" className="text-slate-300">·</span>
                        <span
                          className={`text-xs font-bold ${
                            grupo.estadoTurma === 'concluida'
                              ? 'text-emerald-700'
                              : grupo.estadoTurma === 'em_andamento'
                              ? 'text-amber-700'
                              : 'text-slate-500'
                          }`}
                        >
                          {grupo.estadoTurma === 'concluida'
                            ? 'Concluída'
                            : grupo.estadoTurma === 'em_andamento'
                            ? 'Em andamento'
                            : 'Pendente'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-0.5 tabular-nums">
                        <span>{grupo.alunos.length} estudante(s) exibido(s) em ordem alfabética</span>
                        {atrasosNoGrupo > 0 && <span className="text-amber-700 font-bold">{atrasosNoGrupo} atraso(s)</span>}
                        {dispensasNoGrupo > 0 && <span className="text-blue-700 font-bold">{dispensasNoGrupo} dispensado(s)</span>}
                        {faltasNoGrupo > 0 && <span className="text-rose-700 font-bold">{faltasNoGrupo} falta(s)</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={!podeLancarNoDia}
                      onClick={() => handleConfirmarTurmaPresentes(grupo.turma)}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition cursor-pointer whitespace-nowrap flex items-center gap-1.5"
                    >
                      <i className="fa-solid fa-check text-[11px]"></i>
                      <span>Confirmar Presentes da Turma</span>
                    </button>
                  </div>
                </div>

                {!recolhida && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50/50 text-[10px] font-bold uppercase text-slate-500 tracking-wider border-b border-slate-200">
                        <tr>
                          <th className="py-2.5 px-4 w-10 text-center">#</th>
                          <th className="py-2.5 px-3">Estudante (Ordem Alfabética)</th>
                          <th className="py-2.5 px-3">Tutor PEI</th>
                          <th className="py-2.5 px-4 text-center">Chamada & Integrações</th>
                          <th className="py-2.5 px-3 text-center">1ª Faltas Brutas</th>
                          <th className="py-2.5 px-3 text-center">2ª Licenças/Dispensas</th>
                          <th className="py-2.5 px-3 text-center bg-rose-50/70 text-rose-900 border-x border-rose-200">
                            3ª Faltas Efetivas
                          </th>
                          <th className="py-2.5 px-3 text-center">Atrasos</th>
                          <th className="py-2.5 px-3 text-center">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {grupo.alunos.map((aluno, idx) => {
                          const isCritico = aluno.faltasEfetivas >= 15;
                          const isAlerta = aluno.faltasEfetivas >= 8 && aluno.faltasEfetivas < 15;

                          return (
                            <tr
                              key={aluno.ra || aluno.id || idx}
                              className={`hover:bg-slate-50/80 transition ${
                                aluno.status === 'falta'
                                  ? 'bg-rose-50/35'
                                  : aluno.status === 'atrasado'
                                  ? 'bg-amber-50/35'
                                  : aluno.status === 'licenca'
                                  ? 'bg-blue-50/40'
                                  : ''
                              }`}
                            >
                              <td className="py-2.5 px-4 text-center font-mono text-[11px] text-slate-400 tabular-nums">
                                {idx + 1}
                              </td>

                              <td className="py-2.5 px-3">
                                <div className="flex items-center gap-2.5">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-extrabold text-slate-900 text-xs">{aluno.nome}</span>
                                      {!aluno.verificado && (
                                        <span className="text-[10px] font-semibold text-slate-400">· Pendente</span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono tabular-nums mt-0.5 flex-wrap">
                                      <span>RA {aluno.ra}</span>
                                      {aluno.dispensaAtiva && (
                                        <span className="font-sans font-bold text-blue-800">
                                          · Dispensa ({aluno.dispensaAtiva.motivo}): {formatarDiaCurtoBr(aluno.dispensaAtiva.dataInicio)} a{' '}
                                          {formatarDiaCurtoBr(aluno.dispensaAtiva.dataFim)}
                                        </span>
                                      )}
                                      {aluno.atrasoOcorrencia && (
                                        <span className="font-sans font-bold text-amber-800">
                                          · Atraso Ocorrências às {aluno.atrasoOcorrencia.horario}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </td>

                              <td className="py-2.5 px-3 text-slate-600 font-medium">
                                <span className="truncate block max-w-[140px]" title={aluno.tutor}>
                                  {aluno.tutor}
                                </span>
                              </td>

                              <td className="py-2.5 px-4">
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleAlterarStatus(aluno.ra, 'presente')}
                                    className={`px-2.5 py-1 rounded-lg text-[10px] font-black transition cursor-pointer flex items-center gap-1 ${
                                      aluno.status === 'presente' && aluno.verificado
                                        ? 'bg-emerald-600 text-white'
                                        : aluno.status === 'presente'
                                        ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    }`}
                                    title="Presente"
                                  >
                                    <i className="fa-solid fa-check text-[9px]"></i>
                                    <span>P</span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      const horaAtual = new Date().toLocaleTimeString('pt-BR', {
                                        hour: '2-digit',
                                        minute: '2-digit'
                                      });
                                      handleAlterarStatus(aluno.ra, 'atrasado', {
                                        horarioAtraso: aluno.horarioAtraso || horaAtual
                                      });
                                    }}
                                    className={`px-2.5 py-1 rounded-lg text-[10px] font-black transition cursor-pointer flex items-center gap-1 ${
                                      aluno.status === 'atrasado'
                                        ? 'bg-amber-500 text-slate-950'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    }`}
                                    title="Atrasado"
                                  >
                                    <i className="fa-solid fa-clock text-[9px]"></i>
                                    <span>A</span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => handleAlterarStatus(aluno.ra, 'falta')}
                                    className={`px-2.5 py-1 rounded-lg text-[10px] font-black transition cursor-pointer flex items-center gap-1 ${
                                      aluno.status === 'falta'
                                        ? 'bg-rose-600 text-white'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    }`}
                                    title="Falta Injustificada"
                                  >
                                    <i className="fa-solid fa-xmark text-[9px]"></i>
                                    <span>F</span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleAlterarStatus(aluno.ra, 'licenca', {
                                        motivoLicenca: aluno.motivoLicenca || 'Atestado Médico'
                                      })
                                    }
                                    className={`px-2.5 py-1 rounded-lg text-[10px] font-black transition cursor-pointer flex items-center gap-1 ${
                                      aluno.status === 'licenca'
                                        ? 'bg-blue-700 text-white'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    }`}
                                    title="Licença / Dispensa Justificada"
                                  >
                                    <i className="fa-solid fa-file-medical text-[9px]"></i>
                                    <span>L</span>
                                  </button>
                                </div>

                                {aluno.status === 'atrasado' && (
                                  <div className="mt-1 flex items-center justify-center gap-1">
                                    <input
                                      type="text"
                                      value={aluno.horarioAtraso || ''}
                                      placeholder="07:15"
                                      onChange={(e) =>
                                        handleAlterarStatus(aluno.ra, 'atrasado', { horarioAtraso: e.target.value })
                                      }
                                      className="w-14 px-1 py-0.5 text-[10px] font-mono font-bold text-center border border-amber-300 rounded bg-white tabular-nums"
                                    />
                                    {aluno.origem === 'atraso_ocorrencia' && (
                                      <span className="text-[10px] font-bold text-amber-800">Portaria</span>
                                    )}
                                  </div>
                                )}

                                {aluno.status === 'licenca' && (
                                  <div className="mt-1 flex items-center justify-center gap-1">
                                    <select
                                      value={aluno.motivoLicenca || 'Atestado Médico'}
                                      onChange={(e) =>
                                        handleAlterarStatus(aluno.ra, 'licenca', { motivoLicenca: e.target.value })
                                      }
                                      className="text-[10px] font-bold border border-blue-300 rounded px-1 py-0.5 bg-white text-blue-900 max-w-[160px]"
                                    >
                                      <option value="Atestado Médico">Atestado Médico</option>
                                      <option value="Licença Saúde / Internação">Licença Saúde / Internação</option>
                                      <option value="Afastamento Legal / Judicial">Afastamento Legal / Judicial</option>
                                      <option value="Dispensa Esportiva / Cultural">Dispensa Esportiva / Cultural</option>
                                      <option value="Óbito / Luto Familiar">Óbito / Luto Familiar</option>
                                      <option value="Outros Afastamentos Justificados">Outros Afastamentos Justificados</option>
                                    </select>
                                  </div>
                                )}
                              </td>

                              <td className="py-2.5 px-3 text-center font-bold text-slate-700 tabular-nums">
                                {aluno.faltasTotais}
                              </td>

                              <td className="py-2.5 px-3 text-center font-bold text-blue-700 tabular-nums">
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleAjustarLicencaExtra(aluno.ra, -1, aluno.licencasAfastamentos)}
                                    disabled={aluno.licencasAfastamentos <= 0}
                                    className="w-5 h-5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-black flex items-center justify-center cursor-pointer disabled:opacity-30"
                                    title="Remover 1 dia de licença ajustada"
                                  >
                                    -
                                  </button>
                                  <span className="min-w-[24px] text-center font-extrabold text-[11px] text-blue-800">
                                    {aluno.licencasAfastamentos}d
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleAjustarLicencaExtra(aluno.ra, 1, aluno.licencasAfastamentos)}
                                    className="w-5 h-5 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-black flex items-center justify-center cursor-pointer"
                                    title="Adicionar +1 dia de licença"
                                  >
                                    +
                                  </button>
                                </div>
                              </td>

                              <td className="py-2.5 px-3 text-center bg-rose-50/60 border-x border-rose-200 tabular-nums">
                                <span
                                  className={`font-black text-xs ${
                                    isCritico
                                      ? 'text-rose-700'
                                      : isAlerta
                                      ? 'text-amber-700'
                                      : 'text-emerald-700'
                                  }`}
                                >
                                  {aluno.faltasEfetivas}
                                </span>
                                {aluno.faltasConsecutivas >= 2 && (
                                  <div className="text-[10px] font-bold text-rose-700">
                                    {aluno.faltasConsecutivas}d seguidos
                                  </div>
                                )}
                              </td>

                              <td className="py-2.5 px-3 text-center font-bold tabular-nums">
                                <span className={aluno.atrasosAcumulados > 0 ? 'text-amber-700' : 'text-slate-400'}>
                                  {aluno.atrasosAcumulados}x
                                </span>
                              </td>

                              <td className="py-2.5 px-3 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  {(() => {
                                    const msgIndividual = `Olá! Sou da coordenação da EE Prof. Clóvis de Lucca. Registramos a ausência/atraso do(a) estudante ${aluno.nome} (${aluno.turma}) hoje. Por favor, confirme o recebimento ou informe se há justificativa médica.`;
                                    const encoded = encodeURIComponent(msgIndividual);
                                    const foneLimpo = String(aluno.telefone || '').replace(/\D/g, '');
                                    const waHref = foneLimpo
                                      ? `https://wa.me/55${foneLimpo}?text=${encoded}`
                                      : `https://web.whatsapp.com/send?text=${encoded}`;
                                    return (
                                      <a
                                        href={waHref}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded-lg transition cursor-pointer inline-flex items-center justify-center"
                                        title="Enviar WhatsApp para o responsável"
                                      >
                                        <i className="fa-brands fa-whatsapp text-sm"></i>
                                      </a>
                                    );
                                  })()}

                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (typeof (window as any).abrirFichaAluno === 'function') {
                                        (window as any).abrirFichaAluno(aluno.ra);
                                      } else if (typeof (window as any).navegarEAbrirFichaAluno === 'function') {
                                        (window as any).navegarEAbrirFichaAluno(aluno.ra);
                                      }
                                    }}
                                    className="p-1.5 text-blue-700 hover:bg-blue-50 rounded-lg transition cursor-pointer"
                                    title="Abrir Dossiê (onde Secretaria, CGPG e Direção podem lançar Dispensa)"
                                  >
                                    <i className="fa-solid fa-address-card text-xs"></i>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ============================================================== */}
      {/* MODAL: MENSAGEM WHATSAPP PARA OS PAIS DOS FALTOSOS DO DIA      */}
      {/* ============================================================== */}
      {modalWhatsappAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center text-lg">
                  <i className="fa-brands fa-whatsapp"></i>
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">Mensagem dos Faltosos do Dia para os Pais</h3>
                  <p className="text-xs text-slate-500 font-medium">
                    Boletim oficial em conformidade com a LGPD para envio no WhatsApp.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalWhatsappAberto(false)}
                className="text-slate-400 hover:text-slate-700 p-2 rounded-lg cursor-pointer transition"
              >
                <i className="fa-solid fa-xmark text-lg"></i>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3">
              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-900 flex flex-wrap items-center justify-between gap-2">
                <span>Proteção LGPD ativa: iniciais preservadas sem expor dados médicos.</span>
                {origemMensagemIa && (
                  <span className="font-bold text-emerald-800">
                    {origemMensagemIa === 'gemini' ? 'Redigido por IA' : 'Modelo Oficial'}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-slate-600 mr-1">Tom:</span>
                  {(
                    [
                      { id: 'acolhedor', label: 'Acolhedor' },
                      { id: 'padrao', label: 'Institucional' },
                      { id: 'urgente', label: 'Urgente' }
                    ] as const
                  ).map((tOpt) => (
                    <button
                      key={tOpt.id}
                      type="button"
                      disabled={gerandoMensagemIa}
                      onClick={() => handleGerarMensagemWhatsapp(tOpt.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                        tomComunicado === tOpt.id
                          ? 'bg-emerald-700 text-white'
                          : 'bg-white text-slate-600 border border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      {tOpt.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={gerandoMensagemIa}
                  onClick={() => handleGerarMensagemWhatsapp()}
                  className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <i className={`fa-solid ${gerandoMensagemIa ? 'fa-spinner animate-spin' : 'fa-wand-magic-sparkles'}`}></i>
                  <span>{gerandoMensagemIa ? 'Gerando...' : 'Regerar com IA'}</span>
                </button>
              </div>

              {gerandoMensagemIa ? (
                <div className="p-10 text-center text-slate-500 text-xs font-bold bg-slate-50 rounded-xl border border-slate-200">
                  <i className="fa-solid fa-spinner animate-spin text-2xl text-emerald-600 mb-2 block"></i>
                  Redigindo boletim diário com IA...
                </div>
              ) : (
                <textarea
                  value={textoMensagemWhatsapp}
                  onChange={(e) => setTextoMensagemWhatsapp(e.target.value)}
                  rows={12}
                  className="w-full p-4 font-mono text-xs text-slate-800 bg-slate-50 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                />
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
              <div className="text-xs text-slate-500 font-bold tabular-nums">{textoMensagemWhatsapp.length} caracteres</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopiarMensagem}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl transition flex items-center gap-2 cursor-pointer"
                >
                  <i className="fa-regular fa-copy"></i>
                  <span>Copiar Mensagem</span>
                </button>
                <a
                  href={whatsappWebUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-2 cursor-pointer"
                >
                  <i className="fa-brands fa-whatsapp text-sm"></i>
                  <span>Abrir no WhatsApp Web</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: ANÁLISE COMPORTAMENTAL IA 2027                          */}
      {/* ============================================================== */}
      {modalIaAnaliseAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl border border-slate-200 space-y-5 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-700 text-white flex items-center justify-center text-lg">
                  <i className="fa-solid fa-brain"></i>
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">Mapeamento Comportamental IA · 2027</h3>
                  <p className="text-xs text-slate-500 font-medium">
                    Padrões de atrasos, faltas consecutivas e análise da 3ª Métrica sem licenças.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalIaAnaliseAberto(false)}
                className="text-slate-400 hover:text-slate-700 p-2 rounded-lg cursor-pointer transition"
              >
                <i className="fa-solid fa-xmark text-lg"></i>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {gerandoAnaliseIa ? (
                <div className="p-12 text-center text-slate-500 font-medium text-xs">
                  <i className="fa-solid fa-spinner animate-spin text-3xl text-indigo-600 mb-3 block"></i>
                  Analisando histórico comportamental de frequência 2027 com IA...
                </div>
              ) : analiseIaDados ? (
                <>
                  <div className="bg-indigo-50/70 border border-indigo-200 p-4 rounded-xl text-xs text-indigo-950 space-y-1">
                    <span className="text-[11px] font-bold text-indigo-700">Diagnóstico Executivo</span>
                    <p className="font-medium leading-relaxed">{analiseIaDados.diagnosticoGeral}</p>
                  </div>

                  {analiseIaDados.analiseTerceiraMetrica && (
                    <div className="bg-rose-50/70 border border-rose-200 p-4 rounded-xl space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold text-rose-900">
                        <span>Terceira Métrica (Faltas Efetivas Reais)</span>
                        <span className="tabular-nums">Total: {analiseIaDados.analiseTerceiraMetrica.totalFaltasEfetivas}</span>
                      </div>
                      <p className="text-xs text-rose-900">{analiseIaDados.analiseTerceiraMetrica.explicacao}</p>
                      <p className="text-xs text-rose-950 font-bold">
                        Conclusão: {analiseIaDados.analiseTerceiraMetrica.conclusaoPedagogica}
                      </p>
                    </div>
                  )}

                  {Array.isArray(analiseIaDados.padroesDetectados) && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-black text-slate-700">Padrões Identificados</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        {analiseIaDados.padroesDetectados.map((p: any, idx: number) => (
                          <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-xs text-slate-900">{p.titulo}</span>
                              <span
                                className={`text-[10px] font-bold ${
                                  p.grau === 'ALTO' ? 'text-rose-700' : 'text-amber-700'
                                }`}
                              >
                                {p.grau}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-600">{p.descricao}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {Array.isArray(analiseIaDados.projecaoRisco2027) && analiseIaDados.projecaoRisco2027.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-black text-slate-700">Estudantes Prioritários para Tutoria</h4>
                      <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white">
                        {analiseIaDados.projecaoRisco2027.map((al: any, idx: number) => (
                          <div key={idx} className="p-3 text-xs space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900">{al.nome}</span>
                              <span className="text-slate-500 font-semibold">· {al.turma}</span>
                              <span className={al.nivelRisco === 'CRÍTICO' ? 'text-rose-700 font-black' : 'text-amber-700 font-bold'}>
                                · {al.nivelRisco}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-600">{al.motivo}</p>
                            <p className="text-[11px] text-indigo-900 font-bold">Ação: {al.acaoTutoria2027}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {Array.isArray(analiseIaDados.acoesImediatas) && analiseIaDados.acoesImediatas.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-black text-slate-700">Ações Imediatas Sugeridas (Tempo Real)</h4>
                      <ul className="space-y-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
                        {analiseIaDados.acoesImediatas.map((acao: any, idx: number) => {
                          if (typeof acao === 'string') {
                            return (
                              <li key={idx} className="flex items-start gap-2 text-xs text-slate-700">
                                <i className="fa-solid fa-check text-indigo-600 mt-0.5 text-[10px]"></i>
                                <span>{acao}</span>
                              </li>
                            );
                          }
                          return (
                            <li key={idx} className="bg-white border border-slate-200 rounded-lg p-2.5 space-y-1 text-xs">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-bold text-slate-900">{acao?.titulo || 'Ação Pedagógica'}</span>
                                {acao?.prioridade && (
                                  <span className="text-[10px] font-black text-indigo-700">{acao.prioridade}</span>
                                )}
                              </div>
                              {acao?.descricao && <p className="text-[11px] text-slate-600">{acao.descricao}</p>}
                              {acao?.responsavel && (
                                <p className="text-[10px] font-bold text-slate-500">Responsável: {acao.responsavel}</p>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </>
              ) : null}
            </div>

            <div className="border-t border-slate-100 pt-3 flex justify-end">
              <button
                type="button"
                onClick={() => setModalIaAnaliseAberto(false)}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl cursor-pointer"
              >
                Fechar Painel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
