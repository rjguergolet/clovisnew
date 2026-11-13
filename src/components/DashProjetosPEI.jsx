import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, db } from '../lib/database';

/**
 * Componente Módulo Analítico: Dash Projetos PEI
 * 100% Otimizado para Zero Reads no Firestore
 * Mapeamento e gestão de lotação dos 5 eixos do Protagonismo Juvenil (PEI):
 * 1) Tutoria
 * 2) Clubes Juvenis
 * 3) Disciplinas Eletivas
 * 4) PJ (Protagonismo Juvenil)
 * 5) Projeto de Vida
 *
 * Visibilidade estrita: DIRETOR e VICE_DIRETOR
 */
export default function DashProjetosPEI() {
  const [studentsData, setStudentsData] = useState(() => {
    return (typeof window !== 'undefined' && Array.isArray(window.allStudentsData) && window.allStudentsData.length > 0)
      ? window.allStudentsData
      : [];
  });

  const [projetosList, setProjetosList] = useState(() => {
    if (typeof window !== 'undefined' && Array.isArray(window.projetosCache)) {
      return window.projetosCache;
    }
    const local = typeof window !== 'undefined' ? localStorage.getItem('clovis_projetos_cache') : null;
    return local ? JSON.parse(local) : [];
  });

  const [capacidadesMap, setCapacidadesMap] = useState(() => {
    const local = typeof window !== 'undefined' ? localStorage.getItem('clovis_capacidades_pei_cache') : null;
    return local ? JSON.parse(local) : {};
  });

  const [localCapacidades, setLocalCapacidades] = useState({});
  const [userRole, setUserRole] = useState('DIRETOR');
  const [activeInternalTab, setActiveInternalTab] = useState('grid'); // 'grid' | 'tutor' | 'clube' | 'eletiva' | 'pj' | 'pv' | 'projetos'
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('total-desc'); // 'total-desc' | 'total-asc' | 'name-asc'
  const [expandedRowKey, setExpandedRowKey] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isModalProjetoOpen, setIsModalProjetoOpen] = useState(false);
  const [projetoEdicao, setProjetoEdicao] = useState(null);
  const [salvandoProjeto, setSalvandoProjeto] = useState(false);

  const debounceTimers = useRef({});

  const [formProjeto, setFormProjeto] = useState({
    nome: '',
    eixo: 'eletiva', // 'tutor' | 'clube' | 'eletiva' | 'pj' | 'pv'
    professorResponsavel: '',
    capacidade: 25,
    sala: '',
    descricao: '',
    status: 'ATIVO'
  });

  // 1. CARREGAMENTO CACHE-FIRST (ZERO LEITURAS DESNECESSÁRIAS)
  const carregarProjetosPEI = useCallback(async (forceServer = false, isBackground = false) => {
    if (!isBackground) {
      setLoading(true);
    }
    try {
      // 1.1 Sincronizar Alunos em Memória via window.allStudentsData
      if (typeof window !== 'undefined' && Array.isArray(window.allStudentsData) && window.allStudentsData.length > 0) {
        setStudentsData(window.allStudentsData);
      } else {
        try {
          const snapAlunos = await getDocs(collection(db, 'alunos'), { source: forceServer ? 'server' : 'cache' });
          const listA = [];
          snapAlunos.forEach(d => listA.push({ id: d.id, ra: d.id, ...d.data() }));
          if (listA.length > 0) {
            setStudentsData(listA);
            window.allStudentsData = listA;
          }
        } catch (aErr) {
          if (!forceServer) {
            try {
              const snapServer = await getDocs(collection(db, 'alunos'), { source: 'server' });
              const listA = [];
              snapServer.forEach(d => listA.push({ id: d.id, ra: d.id, ...d.data() }));
              if (listA.length > 0) {
                setStudentsData(listA);
                window.allStudentsData = listA;
              }
            } catch (e2) {}
          }
        }
      }

      // 1.2 Carregar Coleção 'projetos_pei' com Cache-First
      let projsSnapshot;
      const projsCol = collection(db, 'projetos_pei');
      if (forceServer) {
        projsSnapshot = await getDocs(projsCol, { source: 'server' });
      } else {
        try {
          projsSnapshot = await getDocs(projsCol, { source: 'cache' });
          if (!projsSnapshot || projsSnapshot.empty) {
            throw new Error('Cache de projetos vazio');
          }
        } catch (cErr) {
          projsSnapshot = await getDocs(projsCol, { source: 'server' });
        }
      }

      const projsDocs = [];
      projsSnapshot.forEach((docSnap) => {
        projsDocs.push({ id: docSnap.id, ...docSnap.data() });
      });

      if (projsDocs.length > 0) {
        setProjetosList(projsDocs);
        window.projetosCache = projsDocs;
        localStorage.setItem('clovis_projetos_cache', JSON.stringify(projsDocs));
      }

      // 1.3 Carregar Documento de Capacidades com Cache-First
      const docCapRef = doc(db, 'configuracoes', 'capacidadesPEI');
      let capSnap;
      if (forceServer) {
        capSnap = await getDoc(docCapRef);
      } else {
        try {
          capSnap = await getDoc(docCapRef);
        } catch (e) {}
      }

      if (capSnap && capSnap.exists()) {
        const capsData = capSnap.data() || {};
        setCapacidadesMap(capsData);
        localStorage.setItem('clovis_capacidades_pei_cache', JSON.stringify(capsData));
      }
    } catch (err) {
      console.warn('Modo offline/cache ativado para Dash Projetos PEI:', err);
      const cachedProjs = localStorage.getItem('clovis_projetos_cache');
      if (cachedProjs) {
        try {
          const parsed = JSON.parse(cachedProjs);
          setProjetosList(parsed);
          window.projetosCache = parsed;
        } catch (e) {}
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Expor e inicializar o carregamento
  useEffect(() => {
    window.carregarProjetosPEI = carregarProjetosPEI;
    carregarProjetosPEI(false);
  }, [carregarProjetosPEI]);

  // Sincronizar role e dados globais de alunos sem listeners onSnapshot
  const [ocorrenciasTick, setOcorrenciasTick] = useState(0);

  // Sincronizar role e dados globais de alunos e ocorrências em tempo real
  useEffect(() => {
    const updateRoleAndData = () => {
      const role = typeof window.obterRoleAtual === 'function' 
        ? window.obterRoleAtual() 
        : (window.currentUserRole || 'DIRETOR');
      setUserRole(role || 'DIRETOR');

      if (window.allStudentsData && Array.isArray(window.allStudentsData) && window.allStudentsData.length > 0) {
        setStudentsData([...window.allStudentsData]);
      }
      if (window.projetosCache && Array.isArray(window.projetosCache)) {
        setProjetosList([...window.projetosCache]);
      }
      setOcorrenciasTick(t => t + 1);
    };

    updateRoleAndData();
    window.addEventListener('taborrolechange', updateRoleAndData);
    window.addEventListener('clovis_students_updated', updateRoleAndData);
    window.addEventListener('studentsdataupdated', updateRoleAndData);
    window.addEventListener('clovis_ocorrencias_updated', updateRoleAndData);
    window.addEventListener('storage', updateRoleAndData);

    let timerDbChanged = null;
    const handleCollectionChanged = (e) => {
      const col = e?.detail?.collection;
      if (!col || col === 'projetos_pei' || col === 'alunos' || col === 'configuracoes' || col === 'ocorrencias') {
        if (timerDbChanged) clearTimeout(timerDbChanged);
        timerDbChanged = setTimeout(() => {
          carregarProjetosPEI(true, true);
          setOcorrenciasTick(t => t + 1);
        }, 300);
      }
    };
    window.addEventListener('database-collection-changed', handleCollectionChanged);

    return () => {
      if (timerDbChanged) clearTimeout(timerDbChanged);
      window.removeEventListener('taborrolechange', updateRoleAndData);
      window.removeEventListener('clovis_students_updated', updateRoleAndData);
      window.removeEventListener('studentsdataupdated', updateRoleAndData);
      window.removeEventListener('clovis_ocorrencias_updated', updateRoleAndData);
      window.removeEventListener('storage', updateRoleAndData);
      window.removeEventListener('database-collection-changed', handleCollectionChanged);
    };
  }, [carregarProjetosPEI]);

  // Consolidação 100% Automatizada do Dashboard de Tutores ("Quem fez e quantas fez" + Gatilho de 3 Atrasos)
  const paineisTutoriaAutomatizados = useMemo(() => {
    const normalizeKey = (str) =>
      String(str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/\(.*?\)/g, '')
        .trim();

    const baselineCatalog = [
      { key: 'SHEILA', nomeExibicao: 'Sheila', baseAlunos: 25, baseRegistros: 118 },
      { key: 'DJALMA', nomeExibicao: 'Djalma', baseAlunos: 25, baseRegistros: 90 },
      { key: 'SILMARA', nomeExibicao: 'Silmara', baseAlunos: 25, baseRegistros: 90 },
      { key: 'ELISANGELA', nomeExibicao: 'Elisângela', baseAlunos: 25, baseRegistros: 58 },
      { key: 'EBER', nomeExibicao: 'Eber (Vice-Diretor / Apoio)', baseAlunos: 15, baseRegistros: 51 },
      { key: 'ARTHUR', nomeExibicao: 'Arthur', baseAlunos: 25, baseRegistros: 39 },
      { key: 'TUANY', nomeExibicao: 'Tuany (PAAC)', baseAlunos: 22, baseRegistros: 39 },
      { key: 'LEANDRO', nomeExibicao: 'Leandro', baseAlunos: 25, baseRegistros: 37 },
      { key: 'VLADMIR', nomeExibicao: 'Vladmir', baseAlunos: 24, baseRegistros: 23 },
      { key: 'LUCAS', nomeExibicao: 'Lucas', baseAlunos: 24, baseRegistros: 20 },
      { key: 'ROZANNY', nomeExibicao: 'Rozanny', baseAlunos: 24, baseRegistros: 20 },
      { key: 'JOCEMAR', nomeExibicao: 'Jocemar', baseAlunos: 24, baseRegistros: 18 },
      { key: 'DANIEL', nomeExibicao: 'Daniel (CGPG)', baseAlunos: 15, baseRegistros: 17 },
      { key: 'FABIANA', nomeExibicao: 'Fabiana', baseAlunos: 24, baseRegistros: 16 },
      { key: 'TATIANE', nomeExibicao: 'Tatiane (PAAC)', baseAlunos: 20, baseRegistros: 15 },
      { key: 'FERNANDA', nomeExibicao: 'Fernanda', baseAlunos: 24, baseRegistros: 10 },
      { key: 'NOELLY', nomeExibicao: 'Noelly', baseAlunos: 24, baseRegistros: 9 },
      { key: 'ISABELLE', nomeExibicao: 'Isabelle', baseAlunos: 22, baseRegistros: 6 },
      { key: 'RODRIGO', nomeExibicao: 'Rodrigo (Diretor)', baseAlunos: 10, baseRegistros: 5 },
      { key: 'JANAINAVER', nomeExibicao: 'Janainaver', baseAlunos: 20, baseRegistros: 4 },
      { key: 'JENILSON', nomeExibicao: 'Jenilson (CGPG)', baseAlunos: 12, baseRegistros: 3 },
      { key: 'LUCINEIDE', nomeExibicao: 'Lucineide (Vice-Diretora)', baseAlunos: 10, baseRegistros: 3 },
      { key: 'LEIDIELSON', nomeExibicao: 'Leidielson', baseAlunos: 20, baseRegistros: 2 },
      { key: 'ALINE', nomeExibicao: 'Aline', baseAlunos: 26, baseRegistros: 0 },
      { key: 'BERNARDO', nomeExibicao: 'Bernardo', baseAlunos: 24, baseRegistros: 0 },
      { key: 'CLAUDIA', nomeExibicao: 'Cláudia', baseAlunos: 25, baseRegistros: 0 },
      { key: 'CRISTINA', nomeExibicao: 'Cristina', baseAlunos: 26, baseRegistros: 0 },
      { key: 'FERNANDO', nomeExibicao: 'Fernando', baseAlunos: 26, baseRegistros: 0 },
      { key: 'JANAINA', nomeExibicao: 'Janaína', baseAlunos: 27, baseRegistros: 0 },
      { key: 'MARCIO', nomeExibicao: 'Márcio', baseAlunos: 14, baseRegistros: 0 },
      { key: 'REGIVANIA', nomeExibicao: 'Regivânia', baseAlunos: 25, baseRegistros: 0, obs: 'Atua como PAAC, mas possui alunos sob sua tutela' },
      { key: 'RITA DE CASSIA', nomeExibicao: 'Rita de Cássia', baseAlunos: 18, baseRegistros: 0 },
      { key: 'ROSANA', nomeExibicao: 'Rosana', baseAlunos: 14, baseRegistros: 0 },
      { key: 'RUBIA', nomeExibicao: 'Rúbia', baseAlunos: 23, baseRegistros: 0 },
      { key: 'SUELLEN', nomeExibicao: 'Suellen', baseAlunos: 26, baseRegistros: 0 },
      { key: 'VALERIA', nomeExibicao: 'Valéria', baseAlunos: 25, baseRegistros: 0 },
      { key: 'LILIAN', nomeExibicao: 'Lilian', baseAlunos: 0, baseRegistros: 0 },
      { key: 'WELLINGTON', nomeExibicao: 'Wellington', baseAlunos: 0, baseRegistros: 0 }
    ];

    const tutorMap = new Map();
    baselineCatalog.forEach(item => {
      tutorMap.set(item.key, {
        key: item.key,
        nome: item.nomeExibicao,
        baseAlunos: item.baseAlunos,
        liveAlunos: 0,
        baseRegistros: item.baseRegistros,
        liveRegistros: 0,
        pautasAtrasoObrigatorias: 0,
        obs: item.obs || ''
      });
    });

    const matchTutorEntry = (rawName) => {
      const norm = normalizeKey(rawName);
      if (!norm || norm === 'A DEFINIR' || norm === 'SEM TUTOR' || norm === '-') return null;
      if (tutorMap.has(norm)) return tutorMap.get(norm);
      for (const [k, val] of tutorMap.entries()) {
        if (norm.startsWith(k + ' ') || norm === k || (k.length >= 5 && norm.includes(k))) {
          return val;
        }
      }
      const created = {
        key: norm,
        nome: String(rawName).trim(),
        baseAlunos: 0,
        liveAlunos: 0,
        baseRegistros: 0,
        liveRegistros: 0,
        pautasAtrasoObrigatorias: 0,
        obs: ''
      };
      tutorMap.set(norm, created);
      return created;
    };

    const agora = new Date();
    const mesAtual = agora.getMonth();
    const anoAtual = agora.getFullYear();
    const pautasGatilho3Atrasos = [];

    (studentsData || []).forEach(st => {
      if (!st) return;
      if (st.status && String(st.status).toUpperCase().trim() !== 'ATIVO') return;
      const rawTutor = st.tutor || st.tutor_2026 || '';
      const entry = matchTutorEntry(rawTutor);
      if (entry) {
        entry.liveAlunos += 1;
      }

      const ocs = Array.isArray(st.ocorrencias) ? st.ocorrencias : [];
      const atrasosMes = ocs.filter(oc => {
        if (!oc) return false;
        const isAtr = oc.isAtraso === true || String(oc.tipo || oc.categoria || '').toUpperCase().includes('ATRASO');
        if (!isAtr) return false;
        const dt = new Date(oc.data || oc.createdAt || 0);
        return !isNaN(dt.getTime()) && dt.getMonth() === mesAtual && dt.getFullYear() === anoAtual;
      });

      if (atrasosMes.length >= 3) {
        if (entry) entry.pautasAtrasoObrigatorias += 1;
        pautasGatilho3Atrasos.push({
          ra: st.ra || st.id,
          nome: st.nome || 'ESTUDANTE',
          turma: st.turma || '-',
          tutor: entry ? entry.nome : (rawTutor || 'A Definir'),
          atrasosNoMes: atrasosMes.length
        });
      }
    });

    const allOcorrencias = (typeof window !== 'undefined' && Array.isArray(window.ocorrenciasCache) && window.ocorrenciasCache.length > 0)
      ? window.ocorrenciasCache
      : (typeof window !== 'undefined' && Array.isArray(window.ocorrenciasTopLevel) ? window.ocorrenciasTopLevel : []);

    allOcorrencias.forEach(oc => {
      if (!oc) return;
      const tipoUpper = String(oc.tipo || oc.categoria || '').toUpperCase();
      const isTutoria = tipoUpper.includes('TUTORIA') || tipoUpper.includes('ACOLHIMENTO') || oc.gatilhoAutomaticoAtraso === true;
      if (!isTutoria) return;

      const autorRaw = oc.tutorResponsavel || oc.autor_nome || oc.autor || oc.usuario || oc.registradoPor || '';
      const autorLimpo = String(autorRaw).split('•')[0].split('-')[0].trim();
      let entry = matchTutorEntry(autorLimpo);

      if (!entry && oc.ra) {
        const st = (studentsData || []).find(s => String(s.ra || s.id || '').trim() === String(oc.ra).trim());
        if (st && (st.tutor || st.tutor_2026)) {
          entry = matchTutorEntry(st.tutor || st.tutor_2026);
        }
      }

      if (entry) {
        entry.liveRegistros += 1;
      }
    });

    const todosTutores = Array.from(tutorMap.values()).map(t => {
      const alunosAtribuidos = t.liveAlunos > 0 ? t.liveAlunos : t.baseAlunos;
      const registrosRealizados = t.baseRegistros === 0
        ? t.liveRegistros
        : Math.max(t.baseRegistros, t.liveRegistros);
      return {
        ...t,
        alunos: alunosAtribuidos,
        registros: registrosRealizados
      };
    });

    const ativos = todosTutores
      .filter(t => t.registros > 0)
      .sort((a, b) => b.registros - a.registros || a.nome.localeCompare(b.nome, 'pt-BR'));

    const pendentes = todosTutores
      .filter(t => t.registros === 0)
      .sort((a, b) => b.alunos - a.alunos || a.nome.localeCompare(b.nome, 'pt-BR'));

    const totalRegistrosTutoria = ativos.reduce((acc, item) => acc + item.registros, 0);

    return {
      ativos,
      pendentes,
      totalRegistrosTutoria,
      pautasGatilho3Atrasos
    };
  }, [studentsData, ocorrenciasTick]);

  const roleNorm = String(userRole || 'DIRETOR').trim().toUpperCase().replace(/-/g, '_');
  const isAuthorized = roleNorm === 'DIRETOR' || roleNorm === 'VICE_DIRETOR' || roleNorm.includes('VICE') || roleNorm === 'ADMIN';

  // 2. FUNÇÃO DE RE-RENDERIZAÇÃO DO DASHBOARD (ZERO READS)
  const renderizarDashProjetosPEI = useCallback(() => {
    if (typeof window !== 'undefined' && Array.isArray(window.allStudentsData)) {
      setStudentsData([...window.allStudentsData]);
    }
    if (typeof window !== 'undefined' && Array.isArray(window.projetosCache)) {
      setProjetosList([...window.projetosCache]);
    }
  }, []);

  useEffect(() => {
    window.renderizarDashProjetosPEI = renderizarDashProjetosPEI;
  }, [renderizarDashProjetosPEI]);

  // 3. GESTÃO OTIMISTA DE CAPACIDADE INDIVIDUAL (ZERO READS)
  const handleCapacidadeChange = (rowKey, valueStr) => {
    const valNum = parseInt(valueStr, 10);
    const val = isNaN(valNum) || valNum < 1 ? '' : valNum;

    setLocalCapacidades(prev => ({ ...prev, [rowKey]: val }));

    if (debounceTimers.current[rowKey]) {
      clearTimeout(debounceTimers.current[rowKey]);
    }

    debounceTimers.current[rowKey] = setTimeout(async () => {
      const finalVal = val === '' ? 25 : Number(val);
      try {
        const docRef = doc(db, 'configuracoes', 'capacidadesPEI');
        await setDoc(docRef, { [rowKey]: finalVal }, { merge: true });

        // Atualização Otimista em Memória
        setCapacidadesMap(prev => {
          const updated = { ...prev, [rowKey]: finalVal };
          localStorage.setItem('clovis_capacidades_pei_cache', JSON.stringify(updated));
          return updated;
        });

        setLocalCapacidades(prev => {
          const copy = { ...prev };
          delete copy[rowKey];
          return copy;
        });
      } catch (e) {
        console.error("Erro ao salvar capacidade no Firestore:", e);
      }
    }, 600);
  };

  const getGroupCapacity = (rowKey) => {
    if (localCapacidades[rowKey] !== undefined && localCapacidades[rowKey] !== '') {
      return Number(localCapacidades[rowKey]);
    }
    if (capacidadesMap[rowKey] !== undefined && capacidadesMap[rowKey] !== null) {
      return Number(capacidadesMap[rowKey]);
    }
    return 25; // Fallback padrão
  };

  // Helper de inspeção de propriedades de alunos
  const getStudentProp = (student, possibleKeys) => {
    if (!student) return null;
    for (const key of possibleKeys) {
      if (student[key] !== undefined && student[key] !== null && student[key] !== '') {
        return student[key];
      }
      if (student.dadosAcademicos && student.dadosAcademicos[key]) {
        return student.dadosAcademicos[key];
      }
      if (student.pei && student.pei[key]) {
        return student.pei[key];
      }
      if (student.dados && student.dados[key]) {
        return student.dados[key];
      }
      if (student.projetos && student.projetos[key]) {
        return student.projetos[key];
      }
      if (student.eixos && student.eixos[key]) {
        return student.eixos[key];
      }
    }
    return null;
  };

  // 4. CÁLCULO DE INDICADORES 100% OFFLINE EM MEMÓRIA (ZERO READS)
  const aggregateCategory = useCallback((possibleKeys, eixoKey = null) => {
    const baseStudents = (typeof window !== 'undefined' && Array.isArray(window.allStudentsData) && window.allStudentsData.length > 0)
      ? window.allStudentsData
      : studentsData;

    if (!baseStudents || !Array.isArray(baseStudents) || baseStudents.length === 0) return [];

    const grouped = baseStudents.reduce((acc, student) => {
      const status = String(student.status || 'ATIVO').trim().toUpperCase();
      if (status !== 'ATIVO') return acc;

      const rawField = getStudentProp(student, possibleKeys);
      if (!rawField) return acc;

      let items = [];
      if (Array.isArray(rawField)) {
        items = rawField.map(i => String(i).trim());
      } else if (typeof rawField === 'string' || typeof rawField === 'number') {
        items = String(rawField)
          .split(/[,;\n]/)
          .map(i => i.trim());
      }

      items = items.filter(i => {
        if (!i) return false;
        const upper = i.toUpperCase();
        return (
          upper !== '-' &&
          upper !== '—' &&
          upper !== '\u2014' &&
          upper !== 'N/A' &&
          upper !== 'NENHUM' &&
          upper !== 'SEM REGISTRO' &&
          upper !== 'NÃO INFORMADO' &&
          upper !== 'NÃO ATRIBUÍDO' &&
          upper !== 'VAZIO' &&
          upper !== 'SEM TUTOR' &&
          upper !== 'SEM CLUBE' &&
          upper !== 'SEM ELETIVA'
        );
      });

      items.forEach(item => {
        const key = item.toUpperCase();
        if (!acc[key]) {
          acc[key] = {
            name: key,
            total: 0,
            alunos: []
          };
        }
        acc[key].total += 1;

        const studentRa = student.ra || student.id || '-';
        if (!acc[key].alunos.some(a => a.ra === studentRa)) {
          acc[key].alunos.push({
            ra: studentRa,
            nome: student.nome || student.nomeAluno || 'ESTUDANTE',
            turma: student.turma || student.turmaAluno || '-',
            status: student.status || 'Ativo'
          });
        }
      });

      return acc;
    }, {});

    // Adicionar projetos cadastrados explicitamente em window.projetosCache
    if (eixoKey && Array.isArray(window.projetosCache)) {
      window.projetosCache
        .filter(p => p.eixo === eixoKey)
        .forEach(p => {
          const key = p.nome.toUpperCase();
          if (!grouped[key]) {
            grouped[key] = {
              name: key,
              total: 0,
              alunos: [],
              projetoId: p.id,
              professorResponsavel: p.professorResponsavel,
              sala: p.sala
            };
          } else {
            grouped[key].projetoId = p.id;
            grouped[key].professorResponsavel = p.professorResponsavel;
            grouped[key].sala = p.sala;
          }
        });
    }

    let result = Object.values(grouped);

    result.sort((a, b) => {
      if (sortBy === 'total-desc') return b.total - a.total;
      if (sortBy === 'total-asc') return a.total - b.total;
      if (sortBy === 'name-asc') return a.name.localeCompare(b.name);
      return b.total - a.total;
    });

    return result;
  }, [studentsData, sortBy]);

  // 5 Eixos Mapeados
  const tutoresList = useMemo(
    () => aggregateCategory(['tutor', 'tutor_2026', 'tutor_pei', 'tutoria', 'tutor2026', 'professorTutor'], 'tutor'),
    [aggregateCategory]
  );

  const clubesList = useMemo(
    () => aggregateCategory(['clube', 'clube_juvenil', 'clubes', 'clubeJuvenil', 'clube_2026'], 'clube'),
    [aggregateCategory]
  );

  const eletivasList = useMemo(
    () => aggregateCategory(['eletivas', 'eletiva', 'eletiva_1_2026', 'eletiva_2_sem', 'eletiva_1', 'eletiva1', 'disciplinaEletiva'], 'eletiva'),
    [aggregateCategory]
  );

  const pjList = useMemo(
    () => aggregateCategory(['pj', 'protagonismo', 'praticas_juvenis', 'praticas', 'protagonismo_juvenil', 'atuacao'], 'pj'),
    [aggregateCategory]
  );

  const pvList = useMemo(
    () => aggregateCategory(['pv', 'projetoDeVida', 'projeto_vida', 'projeto_vida_2026', 'sonhos', 'projetodevida', 'projetoVida'], 'pv'),
    [aggregateCategory]
  );

  // Mapear estudantes ativos SEM registro em cada um dos 5 Eixos (100% Offline)
  const getSemRegistroAlunos = (possibleKeys) => {
    const baseStudents = (typeof window !== 'undefined' && Array.isArray(window.allStudentsData) && window.allStudentsData.length > 0)
      ? window.allStudentsData
      : studentsData;

    if (!baseStudents || !Array.isArray(baseStudents)) return [];
    return baseStudents.filter(student => {
      const status = String(student.status || 'ATIVO').trim().toUpperCase();
      if (status !== 'ATIVO') return false;
      const rawVal = getStudentProp(student, possibleKeys);
      if (!rawVal) return true;
      if (Array.isArray(rawVal) && rawVal.length === 0) return true;
      const str = String(rawVal).trim().toUpperCase();
      return (
        !str ||
        str === '-' ||
        str === '—' ||
        str === 'N/A' ||
        str === 'NENHUM' ||
        str === 'SEM REGISTRO' ||
        str === 'NÃO INFORMADO' ||
        str === 'NÃO ATRIBUÍDO' ||
        str === 'VAZIO' ||
        str === 'SEM TUTOR' ||
        str === 'SEM CLUBE' ||
        str === 'SEM ELETIVA'
      );
    });
  };

  const semRegistroMap = useMemo(() => {
    return {
      tutor: getSemRegistroAlunos(['tutor', 'tutor_2026', 'tutor_pei', 'tutoria', 'tutor2026', 'professorTutor']),
      clube: getSemRegistroAlunos(['clube', 'clube_juvenil', 'clubes', 'clubeJuvenil', 'clube_2026']),
      eletiva: getSemRegistroAlunos(['eletivas', 'eletiva', 'eletiva_1_2026', 'eletiva_2_sem', 'eletiva_1', 'eletiva1', 'disciplinaEletiva']),
      pj: getSemRegistroAlunos(['pj', 'protagonismo', 'praticas_juvenis', 'praticas', 'protagonismo_juvenil', 'atuacao']),
      pv: getSemRegistroAlunos(['pv', 'projetoDeVida', 'projeto_vida', 'projeto_vida_2026', 'sonhos', 'projetodevida', 'projetoVida'])
    };
  }, [studentsData]);

  // Contagem de grupos lotados em memória
  const getCategoryLotadosCount = (list, categoryKey) => {
    return list.filter(item => {
      const rowKey = `${categoryKey}_${item.name.replace(/[^a-zA-Z0-9_]/g, '_')}`;
      const cap = getGroupCapacity(rowKey);
      return item.total >= cap;
    }).length;
  };

  const lotadosCounts = useMemo(() => {
    const tCount = getCategoryLotadosCount(tutoresList, 'tutor');
    const cCount = getCategoryLotadosCount(clubesList, 'clube');
    const eCount = getCategoryLotadosCount(eletivasList, 'eletiva');
    const pCount = getCategoryLotadosCount(pjList, 'pj');
    const vCount = getCategoryLotadosCount(pvList, 'pv');
    return {
      tutor: tCount,
      clube: cCount,
      eletiva: eCount,
      pj: pCount,
      pv: vCount,
      total: tCount + cCount + eCount + pCount + vCount
    };
  }, [tutoresList, clubesList, eletivasList, pjList, pvList, capacidadesMap, localCapacidades]);

  // 5. GESTÃO OTIMISTA DE PROJETOS PEI (CRIAR / EDITAR / EXCLUIR)
  const handleAbrirModalNovoProjeto = () => {
    setProjetoEdicao(null);
    setFormProjeto({
      nome: '',
      eixo: activeInternalTab !== 'grid' && activeInternalTab !== 'projetos' ? activeInternalTab : 'eletiva',
      professorResponsavel: '',
      capacidade: 25,
      sala: '',
      descricao: '',
      status: 'ATIVO'
    });
    setIsModalProjetoOpen(true);
  };

  const handleSalvarProjeto = async (e) => {
    e.preventDefault();
    if (!formProjeto.nome.trim()) {
      if (typeof window.showToast === 'function') {
        window.showToast('Por favor, informe o nome do projeto/disciplina/clube.', 'warning');
      }
      return;
    }

    setSalvandoProjeto(true);
    const payload = {
      nome: formProjeto.nome.trim(),
      eixo: formProjeto.eixo,
      professorResponsavel: formProjeto.professorResponsavel.trim(),
      capacidade: Number(formProjeto.capacidade) || 25,
      sala: formProjeto.sala.trim(),
      descricao: formProjeto.descricao.trim(),
      status: formProjeto.status || 'ATIVO',
      atualizadoEm: new Date().toISOString()
    };

    try {
      if (projetoEdicao?.id) {
        // Atualizar
        await updateDoc(doc(db, 'projetos_pei', projetoEdicao.id), payload);
        const updatedList = (window.projetosCache || projetosList).map(p => 
          p.id === projetoEdicao.id ? { ...p, ...payload } : p
        );
        window.projetosCache = updatedList;
        setProjetosList(updatedList);
        localStorage.setItem('clovis_projetos_cache', JSON.stringify(updatedList));
      } else {
        // Criar
        const docRef = await addDoc(collection(db, 'projetos_pei'), {
          ...payload,
          criadoEm: new Date().toISOString()
        });
        const novoItem = { id: docRef.id, ...payload, criadoEm: new Date().toISOString() };
        const updatedList = [...(window.projetosCache || projetosList), novoItem];
        window.projetosCache = updatedList;
        setProjetosList(updatedList);
        localStorage.setItem('clovis_projetos_cache', JSON.stringify(updatedList));
      }

      // Atualizar capacidade do grupo
      const rowKey = `${formProjeto.eixo}_${formProjeto.nome.trim().toUpperCase().replace(/[^a-zA-Z0-9_]/g, '_')}`;
      handleCapacidadeChange(rowKey, String(formProjeto.capacidade));

      // Re-renderizar Dashboard sem buscar do banco
      renderizarDashProjetosPEI();

      if (typeof window.showToast === 'function') {
        window.showToast('Projeto PEI salvo com sucesso!', 'success');
      }

      setIsModalProjetoOpen(false);
    } catch (err) {
      console.error('Erro ao salvar projeto no Firestore:', err);
      // Fallback Otimista Local
      const localId = projetoEdicao?.id || `local-proj-${Date.now()}`;
      const localItem = { id: localId, ...payload };
      const updatedList = projetoEdicao?.id
        ? (window.projetosCache || projetosList).map(p => p.id === localId ? localItem : p)
        : [...(window.projetosCache || projetosList), localItem];
      
      window.projetosCache = updatedList;
      setProjetosList(updatedList);
      localStorage.setItem('clovis_projetos_cache', JSON.stringify(updatedList));
      renderizarDashProjetosPEI();
      setIsModalProjetoOpen(false);
    } finally {
      setSalvandoProjeto(false);
    }
  };

  const handleExcluirProjeto = async (id, nomeProjeto, eixo) => {
    try {
      if (id && !id.startsWith('local-proj-')) {
        await deleteDoc(doc(db, 'projetos_pei', id));
      }
      const updatedList = (window.projetosCache || projetosList).filter(p => p.id !== id);
      window.projetosCache = updatedList;
      setProjetosList(updatedList);
      localStorage.setItem('clovis_projetos_cache', JSON.stringify(updatedList));

      // Re-renderizar Dashboard em Memória
      renderizarDashProjetosPEI();

      if (typeof window.showToast === 'function') {
        window.showToast(`Projeto "${nomeProjeto}" excluído com sucesso!`, 'info');
      }
    } catch (err) {
      console.error('Erro ao excluir projeto:', err);
    }
  };

  if (!isAuthorized) {
    return (
      <div className="p-6 md:p-8 bg-[#F8FAFC] min-h-screen flex items-center justify-center">
        <div className="max-w-md w-full bg-white border border-slate-200/80 border-l-4 border-l-rose-500 rounded-3xl p-6 text-center shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)]">
          <div className="w-14 h-14 bg-rose-500/10 text-rose-600 rounded-2xl flex items-center justify-center mx-auto mb-4 text-xl">
            <i className="fa-solid fa-lock"></i>
          </div>
          <h3 className="text-lg font-bold text-slate-900 tracking-tight">Acesso Restrito ao Módulo</h3>
          <p className="text-xs text-slate-600 mt-2 leading-relaxed">
            O painel analítico <strong className="text-rose-700">Dash Projetos PEI</strong> é de uso exclusivo da Equipe Gestora (<strong>DIRETOR</strong> e <strong>VICE_DIRETOR</strong>).
          </p>
          <div className="mt-5 p-3 bg-slate-50 border border-slate-200/80 rounded-xl text-xs text-slate-500">
            Perfil Detectado: <span className="font-semibold text-slate-800">{userRole}</span>
          </div>
        </div>
      </div>
    );
  }

  // Renderizador de Tabela por Categoria
  const renderTable = (title, iconClass, colorTheme, itemsList, categoryKey) => {
    const filteredItems = itemsList.filter(item =>
      item.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const themeMap = {
      blue: { iconBox: 'bg-indigo-500/10 text-indigo-600', pill: 'bg-indigo-50 text-indigo-700 border-indigo-200/60' },
      emerald: { iconBox: 'bg-emerald-500/10 text-emerald-600', pill: 'bg-emerald-50 text-emerald-700 border-emerald-200/60' },
      purple: { iconBox: 'bg-purple-500/10 text-purple-600', pill: 'bg-purple-50 text-purple-700 border-purple-200/60' },
      amber: { iconBox: 'bg-amber-500/10 text-amber-600', pill: 'bg-amber-50 text-amber-700 border-amber-200/60' },
      indigo: { iconBox: 'bg-indigo-500/10 text-indigo-600', pill: 'bg-indigo-50 text-indigo-700 border-indigo-200/60' }
    };

    const theme = themeMap[colorTheme] || themeMap.blue;

    return (
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] overflow-hidden flex flex-col">
        <div className="px-4 sm:px-5 py-4 bg-white border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm shrink-0 ${theme.iconBox}`}>
              <i className={iconClass}></i>
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900">{title}</h3>
              <p className="text-[11px] text-slate-500 font-medium tabular-nums">{filteredItems.length} registros mapeados</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(semRegistroMap[categoryKey] || []).length > 0 && (
              <span
                className="px-2.5 py-1 bg-rose-50/90 text-rose-800 border border-rose-200/60 border-l-4 border-l-rose-500 font-semibold text-[11px] rounded-lg flex items-center gap-1.5 tabular-nums"
                title="Quantidade de alunos ativos sem registro nesta categoria"
              >
                <i className="fa-solid fa-user-xmark text-[10px] text-rose-600"></i>
                <span>{(semRegistroMap[categoryKey] || []).length} Sem Registro</span>
              </span>
            )}
            <span className={`px-2.5 py-1 rounded-lg border text-xs font-semibold tabular-nums shrink-0 ${theme.pill}`}>
              {filteredItems.reduce((acc, curr) => acc + curr.total, 0)} Alunos
            </span>
          </div>
        </div>

        <div className="sm:hidden divide-y divide-slate-100 max-h-[440px] overflow-y-auto">
          {filteredItems.length === 0 ? (
            <div className="p-6 text-center text-slate-400 font-medium text-xs">
              Nenhum registro encontrado para esta categoria.
            </div>
          ) : (
            filteredItems.map((item) => {
              const rowKey = `${categoryKey}_${item.name.replace(/[^a-zA-Z0-9_]/g, '_')}`;
              const cap = getGroupCapacity(rowKey);
              const isCapacityFull = item.total >= cap;
              const isExpanded = expandedRowKey === rowKey;

              return (
                <div key={rowKey} className={`p-3.5 space-y-2.5 ${isCapacityFull ? 'bg-rose-50/40 border-l-4 border-l-rose-500' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className={`font-semibold text-xs block ${isCapacityFull ? 'text-rose-900' : 'text-slate-900'}`}>
                        {item.name}
                      </span>
                      {item.professorResponsavel && (
                        <span className="text-[11px] text-slate-500 block">
                          Prof. {item.professorResponsavel} {item.sala ? `· ${item.sala}` : ''}
                        </span>
                      )}
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-md border-l-2 text-[11px] font-semibold tabular-nums shrink-0 ${
                        isCapacityFull
                          ? 'bg-rose-50 text-rose-800 border-l-rose-500'
                          : 'bg-emerald-50 text-emerald-800 border-l-emerald-500'
                      }`}
                    >
                      {isCapacityFull ? `Lotado (${item.total}/${cap})` : `${item.total}/${cap}`}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                      <span>Cap. Máx:</span>
                      <input
                        type="number"
                        min="1"
                        max="300"
                        value={
                          localCapacidades[rowKey] !== undefined
                            ? localCapacidades[rowKey]
                            : (capacidadesMap[rowKey] !== undefined ? capacidadesMap[rowKey] : 25)
                        }
                        onChange={(e) => handleCapacidadeChange(rowKey, e.target.value)}
                        className="w-16 px-2 py-1 bg-white border border-slate-200 rounded-lg text-center font-mono font-semibold text-xs text-slate-800"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpandedRowKey(isExpanded ? null : rowKey)}
                      className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-[11px] rounded-lg transition cursor-pointer inline-flex items-center gap-1"
                    >
                      <i className={`fa-solid ${isExpanded ? 'fa-chevron-up' : 'fa-users'} text-[10px]`}></i>
                      <span>{isExpanded ? 'Ocultar' : `Ver Alunos (${item.alunos.length})`}</span>
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="bg-slate-50 rounded-xl border border-slate-200/80 p-2.5 max-h-44 overflow-y-auto space-y-1.5">
                      {item.alunos.map((aluno, aIdx) => (
                        <div key={aluno.ra || aIdx} className="flex items-center justify-between text-[11px] py-1 border-b border-slate-100 last:border-b-0">
                          <div className="min-w-0 pr-2">
                            <div className="font-semibold text-slate-800 truncate">{aluno.nome}</div>
                            <div className="text-[10px] text-slate-500 font-mono">RA {aluno.ra} · {aluno.turma}</div>
                          </div>
                          <span className="px-1.5 py-0.5 bg-white border border-slate-200 text-slate-600 font-semibold text-[10px] rounded">
                            {aluno.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="hidden sm:block overflow-x-auto max-h-[440px] custom-scrollbar flex-1">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50/90 text-slate-500 font-semibold border-b border-slate-200/80 text-[11px] sticky top-0 z-10">
                <th className="p-3">Grupo / Professor ({title})</th>
                <th className="p-3 text-center">Inscritos</th>
                <th className="p-3 text-center">Capacidade Máx.</th>
                <th className="p-3 text-center">Status Lotação</th>
                <th className="p-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-400 font-medium text-xs">
                    Nenhum registro encontrado para esta categoria.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const rowKey = `${categoryKey}_${item.name.replace(/[^a-zA-Z0-9_]/g, '_')}`;
                  const cap = getGroupCapacity(rowKey);
                  const isCapacityFull = item.total >= cap;
                  const isExpanded = expandedRowKey === rowKey;

                  return (
                    <React.Fragment key={rowKey}>
                      <tr
                        className={`transition-colors ${
                          isCapacityFull
                            ? 'bg-rose-50/50 hover:bg-rose-50/80 border-l-4 border-l-rose-500'
                            : 'hover:bg-slate-50/80'
                        }`}
                      >
                        <td className="p-3">
                          <span className={`font-semibold text-xs block ${isCapacityFull ? 'text-rose-900' : 'text-slate-900'}`}>
                            {item.name}
                          </span>
                          {item.professorResponsavel && (
                            <span className="text-[11px] text-slate-500 font-medium block mt-0.5">
                              Prof. {item.professorResponsavel} {item.sala ? `(${item.sala})` : ''}
                            </span>
                          )}
                        </td>

                        <td className="p-3 text-center tabular-nums">
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded-lg font-mono font-bold text-xs ${
                              isCapacityFull
                                ? 'bg-rose-600 text-white'
                                : 'bg-slate-100 text-slate-800'
                            }`}
                          >
                            {item.total}
                          </span>
                        </td>

                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <input
                              type="number"
                              min="1"
                              max="300"
                              value={
                                localCapacidades[rowKey] !== undefined
                                  ? localCapacidades[rowKey]
                                  : (capacidadesMap[rowKey] !== undefined ? capacidadesMap[rowKey] : 25)
                              }
                              onChange={(e) => handleCapacidadeChange(rowKey, e.target.value)}
                              title="Alterar limite individual"
                              className="w-16 px-2 py-1 bg-white border border-slate-200 rounded-xl text-center font-mono font-semibold text-xs text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/30 tabular-nums"
                            />
                          </div>
                        </td>

                        <td className="p-3 text-center whitespace-nowrap tabular-nums">
                          {isCapacityFull ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-50/90 text-rose-900 border border-rose-200/60 border-l-4 border-l-rose-500 font-semibold text-[11px] rounded-lg">
                              <i className="fa-solid fa-triangle-exclamation text-rose-600"></i>
                              <span>Lotado ({item.total}/{cap})</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50/90 text-emerald-900 border border-emerald-200/60 border-l-4 border-l-emerald-500 font-semibold text-[11px] rounded-lg">
                              <i className="fa-solid fa-circle-check text-[10px] text-emerald-600"></i>
                              <span>Regular ({item.total}/{cap})</span>
                            </span>
                          )}
                        </td>

                        <td className="p-3 text-right">
                          <button
                            type="button"
                            onClick={() => setExpandedRowKey(isExpanded ? null : rowKey)}
                            className="px-2.5 py-1 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold text-[11px] rounded-xl transition-colors cursor-pointer inline-flex items-center gap-1 border border-slate-200"
                            title="Expandir ou ocultar lista de alunos nesta tabela"
                          >
                            <i className={`fa-solid ${isExpanded ? 'fa-chevron-up' : 'fa-users'} text-[10px]`}></i>
                            <span>{isExpanded ? 'Ocultar' : 'Ver Alunos'}</span>
                          </button>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-slate-50/70 border-b border-slate-200">
                          <td colSpan={5} className="p-3">
                            <div className="bg-white rounded-2xl border border-slate-200/80 p-3">
                              <div className="flex items-center justify-between mb-2">
                                <span className="font-semibold text-slate-700 text-xs flex items-center gap-1.5">
                                  <i className="fa-solid fa-users text-indigo-600"></i>
                                  Lista de Estudantes ({item.alunos.length})
                                </span>
                                <span className="text-[11px] font-mono text-slate-400">
                                  Grupo: {item.name}
                                </span>
                              </div>
                              <div className="max-h-48 overflow-y-auto custom-scrollbar">
                                <table className="w-full text-left text-[11px]">
                                  <thead>
                                    <tr className="text-slate-400 font-semibold text-[10px] border-b border-slate-100">
                                      <th className="py-1.5 px-2">RA</th>
                                      <th className="py-1.5 px-2">Nome Completo</th>
                                      <th className="py-1.5 px-2">Turma</th>
                                      <th className="py-1.5 px-2">Status</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {item.alunos.map((aluno, aIdx) => (
                                      <tr key={aluno.ra || aIdx} className="hover:bg-slate-50">
                                        <td className="py-1.5 px-2 font-mono text-slate-500 tabular-nums">{aluno.ra}</td>
                                        <td className="py-1.5 px-2 font-semibold text-slate-800">{aluno.nome}</td>
                                        <td className="py-1.5 px-2 font-medium text-slate-600">{aluno.turma}</td>
                                        <td className="py-1.5 px-2">
                                          <span className="px-2 py-0.5 bg-slate-100 text-slate-700 font-semibold text-[10px] rounded-md">
                                            {aluno.status}
                                          </span>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full p-3 sm:p-6 bg-[#F8FAFC] min-h-screen space-y-5">
      {/* Cabeçalho Superior Glassmorphic */}
      <header className="bg-white/90 backdrop-blur-md md:sticky md:top-2 z-20 p-4 sm:p-5 rounded-3xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-lg shrink-0">
            <i className="fa-solid fa-diagram-project"></i>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-slate-100 text-slate-700 font-semibold text-[11px] rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                Gestão PEI · Cache Ativo
              </span>
              {lotadosCounts.total > 0 && (
                <span className="px-2.5 py-0.5 bg-rose-50 text-rose-800 border border-rose-200/60 border-l-4 border-l-rose-500 font-semibold text-[11px] rounded-lg tabular-nums">
                  {lotadosCounts.total} Grupos Lotados
                </span>
              )}
            </div>
            <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight mt-1">
              Dash Projetos PEI · 5 Eixos do Protagonismo
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Mapeamento analítico e definição individual de capacidade com cálculos em memória.
            </p>
          </div>
        </div>

        {/* Ferramentas de Ação, Pesquisa e Ordenação */}
        <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
          <button
            type="button"
            onClick={handleAbrirModalNovoProjeto}
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl shadow-2xs transition flex items-center gap-2 cursor-pointer"
          >
            <i className="fa-solid fa-plus text-emerald-400"></i>
            <span>Novo Projeto</span>
          </button>

          <button
            type="button"
            onClick={() => carregarProjetosPEI(true)}
            disabled={loading}
            className="p-2 bg-white hover:bg-slate-50 text-slate-600 font-semibold text-xs rounded-xl transition border border-slate-200 cursor-pointer"
            title="Recarregar dados do servidor caso necessário"
          >
            <i className={`fa-solid fa-rotate ${loading ? 'fa-spin text-indigo-600' : ''}`}></i>
          </button>

          <div className="relative flex-1 lg:flex-none">
            <i className="fa-solid fa-magnifying-glass absolute left-3 top-2.5 text-slate-400 text-xs"></i>
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Buscar grupo ou professor..."
              className="pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500/30 w-full lg:w-56"
            />
          </div>

          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/30 cursor-pointer"
          >
            <option value="total-desc">Mais Alunos primeiro</option>
            <option value="total-asc">Menos Alunos primeiro</option>
            <option value="name-asc">Ordem Alfabética</option>
          </select>
        </div>
      </header>

      {/* Bento Grid: Resumo dos 5 Eixos */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { key: 'tutor', title: 'Tutoria', icon: 'fa-solid fa-user-tie', iconBox: 'bg-indigo-500/10 text-indigo-600', count: `${tutoresList.length} Grupos`, total: tutoresList.reduce((a, b) => a + b.total, 0), emptyLabel: 'Sem Tutor', emptyCount: semRegistroMap.tutor.length },
          { key: 'clube', title: 'Clubes Juvenis', icon: 'fa-solid fa-users-line', iconBox: 'bg-emerald-500/10 text-emerald-600', count: `${clubesList.length} Clubes`, total: clubesList.reduce((a, b) => a + b.total, 0), emptyLabel: 'Sem Clube', emptyCount: semRegistroMap.clube.length },
          { key: 'eletiva', title: 'Eletivas', icon: 'fa-solid fa-book-open-reader', iconBox: 'bg-purple-500/10 text-purple-600', count: `${eletivasList.length} Eletivas`, total: eletivasList.reduce((a, b) => a + b.total, 0), emptyLabel: 'Sem Eletiva', emptyCount: semRegistroMap.eletiva.length },
          { key: 'pj', title: 'PJ (Protagonismo)', icon: 'fa-solid fa-rocket', iconBox: 'bg-amber-500/10 text-amber-600', count: `${pjList.length} Grupos`, total: pjList.reduce((a, b) => a + b.total, 0), emptyLabel: 'Sem PJ', emptyCount: semRegistroMap.pj.length },
          { key: 'pv', title: 'Projeto de Vida', icon: 'fa-solid fa-compass', iconBox: 'bg-sky-500/10 text-sky-600', count: `${pvList.length} Grupos`, total: pvList.reduce((a, b) => a + b.total, 0), emptyLabel: 'Sem PV', emptyCount: semRegistroMap.pv.length }
        ].map((card) => (
          <div
            key={card.key}
            onClick={() => setActiveInternalTab(card.key)}
            className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] flex flex-col justify-between cursor-pointer hover:border-slate-300 transition"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500">{card.title}</span>
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs shrink-0 ${card.iconBox}`}>
                <i className={card.icon}></i>
              </div>
            </div>
            <div className="mt-2.5 space-y-1.5">
              <div className="text-lg font-bold text-slate-900 tabular-nums">{card.count}</div>
              <div className="text-[11px] font-medium text-slate-500 tabular-nums">
                {card.total} Alunos Atribuídos
              </div>
              <div className="mt-1 text-[11px] font-semibold text-rose-800 bg-rose-50/90 px-2.5 py-1 rounded-lg border border-rose-200/60 border-l-4 border-l-rose-500 w-full flex items-center justify-between tabular-nums">
                <span>{card.emptyLabel}:</span>
                <span className="font-bold text-rose-700">{card.emptyCount}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filter Pills Horizontais Deslizáveis dos Eixos */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
        <button
          type="button"
          onClick={() => setActiveInternalTab('grid')}
          className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            activeInternalTab === 'grid'
              ? 'bg-slate-900 text-white shadow-2xs'
              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200/80'
          }`}
        >
          <i className="fa-solid fa-table-cells mr-1.5"></i>
          Visão Geral (5 Eixos)
        </button>

        <button
          type="button"
          onClick={() => setActiveInternalTab('tutor')}
          className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            activeInternalTab === 'tutor'
              ? 'bg-slate-900 text-white shadow-2xs'
              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200/80'
          }`}
        >
          <i className="fa-solid fa-user-tie mr-1.5 text-indigo-500"></i>
          Tutoria ({tutoresList.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveInternalTab('clube')}
          className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            activeInternalTab === 'clube'
              ? 'bg-slate-900 text-white shadow-2xs'
              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200/80'
          }`}
        >
          <i className="fa-solid fa-users-line mr-1.5 text-emerald-500"></i>
          Clubes Juvenis ({clubesList.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveInternalTab('eletiva')}
          className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            activeInternalTab === 'eletiva'
              ? 'bg-slate-900 text-white shadow-2xs'
              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200/80'
          }`}
        >
          <i className="fa-solid fa-book-open-reader mr-1.5 text-purple-500"></i>
          Eletivas ({eletivasList.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveInternalTab('pj')}
          className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            activeInternalTab === 'pj'
              ? 'bg-slate-900 text-white shadow-2xs'
              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200/80'
          }`}
        >
          <i className="fa-solid fa-rocket mr-1.5 text-amber-500"></i>
          PJ ({pjList.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveInternalTab('pv')}
          className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            activeInternalTab === 'pv'
              ? 'bg-slate-900 text-white shadow-2xs'
              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200/80'
          }`}
        >
          <i className="fa-solid fa-compass mr-1.5 text-sky-500"></i>
          Projeto de Vida ({pvList.length})
        </button>
      </div>

      {/* Exibição das Tabelas */}
      {activeInternalTab === 'grid' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {renderTable('Tutoria', 'fa-solid fa-user-tie', 'blue', tutoresList, 'tutor')}
          {renderTable('Clubes Juvenis', 'fa-solid fa-users-line', 'emerald', clubesList, 'clube')}
          {renderTable('Disciplinas Eletivas', 'fa-solid fa-book-open-reader', 'purple', eletivasList, 'eletiva')}
          {renderTable('PJ (Protagonismo)', 'fa-solid fa-rocket', 'amber', pjList, 'pj')}
          {renderTable('Projeto de Vida', 'fa-solid fa-compass', 'indigo', pvList, 'pv')}
        </div>
      )}

      {activeInternalTab === 'tutor' && (
        <div className="space-y-5">
          {/* Alerta Suave de Gatilho Automático de Atrasos */}
          <div className="bg-indigo-50/80 text-slate-800 p-4 sm:p-5 rounded-2xl border border-indigo-200/60 border-l-4 border-l-indigo-600 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-base shrink-0">
                <i className="fa-solid fa-bolt"></i>
              </div>
              <div>
                <div className="text-[11px] font-semibold text-indigo-700">
                  Automação Escolar Ativa · Resolução SEDUC
                </div>
                <h2 className="text-sm sm:text-base font-bold text-slate-900 mt-0.5">
                  Gatilho Automático: 3 Atrasos no Mês ➔ Termo de Ciência &amp; Pauta de Tutoria
                </h2>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Ao atingir <strong>3 atrasos no mês</strong>, o sistema emite o <strong>Termo de Ciência de Frequência</strong> e agenda obrigatoriamente a pauta na sessão semanal de Tutoria.
                </p>
              </div>
            </div>
            <div className="px-3.5 py-1.5 bg-white rounded-xl border border-indigo-200/80 text-indigo-700 text-xs font-semibold shrink-0">
              Automação Ativa
            </div>
          </div>

          {/* Fila Automatizada de Pautas Obrigatórias de Tutoria */}
          {paineisTutoriaAutomatizados.pautasGatilho3Atrasos.length > 0 && (
            <div className="bg-amber-50/80 border border-amber-200/70 border-l-4 border-l-amber-500 rounded-2xl p-4">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2.5 py-1 bg-amber-100 text-amber-900 font-semibold text-xs rounded-lg tabular-nums">
                    {paineisTutoriaAutomatizados.pautasGatilho3Atrasos.length} Pauta(s) Obrigatória(s) no Mês
                  </span>
                  <span className="text-xs font-medium text-amber-900">
                    Estudantes com 3+ atrasos no mês vigente
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {paineisTutoriaAutomatizados.pautasGatilho3Atrasos.slice(0, 9).map(item => (
                  <div key={item.ra} className="bg-white border border-amber-200/80 rounded-xl p-3 flex items-center justify-between gap-2 shadow-2xs">
                    <div className="min-w-0">
                      <div className="font-semibold text-xs text-slate-900 truncate">{item.nome}</div>
                      <div className="text-[11px] text-slate-500">
                        Turma: <strong className="text-slate-700">{item.turma}</strong> · Tutor: <strong className="text-indigo-700">{item.tutor}</strong>
                      </div>
                      <div className="text-[11px] font-semibold text-rose-700 mt-0.5 tabular-nums">
                        {item.atrasosNoMes} atrasos no mês
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => window.emitirTermoCienciaFrequenciaGatilho && window.emitirTermoCienciaFrequenciaGatilho(item.ra, item.atrasosNoMes)}
                      className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-[11px] rounded-xl shrink-0 cursor-pointer transition"
                      title="Emitir Termo de Ciência de Frequência"
                    >
                      <i className="fa-solid fa-file-signature mr-1"></i> Termo
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dash de Tutores Automatizado */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] overflow-hidden flex flex-col">
              <div className="px-5 py-4 bg-white border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center text-sm">
                    <i className="fa-solid fa-circle-check"></i>
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-slate-900">Relação de Tutores Ativos</h3>
                    <p className="text-[11px] text-slate-500 font-medium tabular-nums">
                      {paineisTutoriaAutomatizados.totalRegistrosTutoria} registros acumulados
                    </p>
                  </div>
                </div>
                <span className="px-2.5 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200/60 rounded-lg text-xs font-semibold tabular-nums">
                  {paineisTutoriaAutomatizados.ativos.length} Tutores
                </span>
              </div>
              <div className="p-3 max-h-[500px] overflow-y-auto custom-scrollbar divide-y divide-slate-100">
                {paineisTutoriaAutomatizados.ativos.map((t, idx) => (
                  <div key={t.key} className="py-2.5 flex items-center justify-between text-xs hover:bg-slate-50 px-2.5 rounded-xl">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-6 h-6 rounded-lg bg-emerald-50 text-emerald-700 font-mono text-[11px] flex items-center justify-center font-semibold shrink-0 tabular-nums">
                        {idx + 1}
                      </span>
                      <div className="min-w-0">
                        <span className="font-semibold text-slate-900 block truncate">{t.nome}</span>
                        <span className="text-[11px] text-slate-500 font-medium tabular-nums">
                          {t.alunos} alunos atribuídos
                          {t.pautasAtrasoObrigatorias > 0 && (
                            <span className="ml-1.5 text-amber-700 font-semibold">
                              · {t.pautasAtrasoObrigatorias} pauta(s) 3+ atrasos
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 bg-emerald-50 text-emerald-800 font-mono font-semibold text-xs rounded-lg shrink-0 tabular-nums">
                      {t.registros} reg.
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_2px_15px_-3px_rgba(15,23,42,0.04)] overflow-hidden flex flex-col">
              <div className="px-5 py-4 bg-white border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center text-sm">
                    <i className="fa-solid fa-user-clock"></i>
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-slate-900">Aguardando Lançamentos</h3>
                    <p className="text-[11px] text-slate-500 font-medium">Tutores com 0 registros realizados</p>
                  </div>
                </div>
                <span className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold tabular-nums">
                  {paineisTutoriaAutomatizados.pendentes.length} Tutores
                </span>
              </div>
              <div className="p-3 max-h-[500px] overflow-y-auto custom-scrollbar divide-y divide-slate-100">
                {paineisTutoriaAutomatizados.pendentes.map((t) => (
                  <div key={t.key} className="py-2.5 flex items-center justify-between text-xs hover:bg-slate-50 px-2.5 rounded-xl">
                    <div className="min-w-0 pr-2">
                      <span className="font-semibold text-slate-900 block truncate">{t.nome}</span>
                      <span className="text-[11px] text-slate-500 font-medium tabular-nums">
                        {t.alunos} alunos · {t.registros} registros {t.obs ? `— ${t.obs}` : ''}
                      </span>
                    </div>
                    <span className="px-2.5 py-1 bg-slate-100 text-slate-600 font-mono font-semibold text-xs rounded-lg shrink-0 tabular-nums">
                      {t.registros} reg.
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {renderTable('Detalhamento dos Grupos de Tutoria', 'fa-solid fa-user-tie', 'blue', tutoresList, 'tutor')}
        </div>
      )}

      {activeInternalTab === 'clube' && renderTable('Clubes Juvenis', 'fa-solid fa-users-line', 'emerald', clubesList, 'clube')}
      {activeInternalTab === 'eletiva' && renderTable('Disciplinas Eletivas', 'fa-solid fa-book-open-reader', 'purple', eletivasList, 'eletiva')}
      {activeInternalTab === 'pj' && renderTable('PJ (Protagonismo)', 'fa-solid fa-rocket', 'amber', pjList, 'pj')}
      {activeInternalTab === 'pv' && renderTable('Projeto de Vida', 'fa-solid fa-compass', 'indigo', pvList, 'pv')}

      {/* MODAL PARA CRIAÇÃO / EDIÇÃO DE PROJETO PEI (BOTTOM-SHEET MOBILE) */}
      {isModalProjetoOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-xs sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl border border-slate-200/80 shadow-2xl max-w-lg w-full overflow-hidden max-h-[90vh] flex flex-col">
            <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto mt-2.5 sm:hidden shrink-0"></div>
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center text-sm">
                  <i className="fa-solid fa-folder-plus"></i>
                </div>
                <h3 className="font-bold text-base text-slate-900">
                  {projetoEdicao ? 'Editar Projeto PEI' : 'Novo Projeto PEI'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsModalProjetoOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-2 rounded-xl hover:bg-slate-100 cursor-pointer transition"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <form onSubmit={handleSalvarProjeto} className="p-5 space-y-4 text-xs font-medium text-slate-700 overflow-y-auto flex-1">
              <div>
                <label className="block mb-1.5 font-semibold text-slate-700">Eixo do Protagonismo</label>
                <select
                  value={formProjeto.eixo}
                  onChange={e => setFormProjeto({ ...formProjeto, eixo: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/30 font-semibold text-slate-800"
                >
                  <option value="eletiva">Disciplinas Eletivas</option>
                  <option value="clube">Clubes Juvenis</option>
                  <option value="tutor">Tutoria</option>
                  <option value="pj">PJ (Protagonismo Juvenil)</option>
                  <option value="pv">Projeto de Vida</option>
                </select>
              </div>

              <div>
                <label className="block mb-1.5 font-semibold text-slate-700">Nome do Projeto / Disciplina / Grupo</label>
                <input
                  type="text"
                  required
                  value={formProjeto.nome}
                  onChange={e => setFormProjeto({ ...formProjeto, nome: e.target.value })}
                  placeholder="Ex: Robótica Sustentável, Clube de Xadrez..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/30 font-semibold text-slate-800"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1.5 font-semibold text-slate-700">Prof. Responsável</label>
                  <input
                    type="text"
                    value={formProjeto.professorResponsavel}
                    onChange={e => setFormProjeto({ ...formProjeto, professorResponsavel: e.target.value })}
                    placeholder="Nome do docente"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/30"
                  />
                </div>
                <div>
                  <label className="block mb-1.5 font-semibold text-slate-700">Capacidade Máxima</label>
                  <input
                    type="number"
                    min="1"
                    max="300"
                    value={formProjeto.capacidade}
                    onChange={e => setFormProjeto({ ...formProjeto, capacidade: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/30 font-mono font-semibold tabular-nums"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1.5 font-semibold text-slate-700">Sala / Local</label>
                  <input
                    type="text"
                    value={formProjeto.sala}
                    onChange={e => setFormProjeto({ ...formProjeto, sala: e.target.value })}
                    placeholder="Ex: Lab de Informática"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/30"
                  />
                </div>
                <div>
                  <label className="block mb-1.5 font-semibold text-slate-700">Status</label>
                  <select
                    value={formProjeto.status}
                    onChange={e => setFormProjeto({ ...formProjeto, status: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/30 font-semibold text-slate-800"
                  >
                    <option value="ATIVO">Ativo</option>
                    <option value="INATIVO">Inativo</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block mb-1.5 font-semibold text-slate-700">Descrição / Ementa</label>
                <textarea
                  rows="2"
                  value={formProjeto.descricao}
                  onChange={e => setFormProjeto({ ...formProjeto, descricao: e.target.value })}
                  placeholder="Objetivos e informações do projeto..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/30"
                ></textarea>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalProjetoOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl cursor-pointer transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoProjeto}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl shadow-2xs cursor-pointer transition"
                >
                  {salvandoProjeto ? 'Salvando...' : 'Salvar Projeto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
