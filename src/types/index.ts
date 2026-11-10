export type PlatformCategory =
  | 'avaliacoes'
  | 'plataformas_digitais'
  | 'frequencia_busca_ativa'
  | 'gestao_docente'
  | 'modelo_pei_futuro'
  | 'infraestrutura';

declare global {
  interface Window {
    obterRoleAtual?: () => string;
    currentUserRole?: string;
    currentActiveTab?: string;
    navegarEAbrirFichaAluno?: (ra: string) => void;
  }
}

export interface PlatformConfig {
  id: string;
  name: string;
  code: string;
  category: PlatformCategory;
  categoryLabel: string;
  badgeText?: string;
  description: string;
  targetMetricName: string;
  targetMetricUnit: string;
  seducTarget: number;
  criticalThreshold: number;
  accentColor: string;
  lightBg: string;
  supportedFormats: string[];
  sampleColumns: string[];
  applicableGrades: string;
  focoPedagogico?: string;
  publicoAlvo?: string;
  regraCalculoBI?: string;
  pesoSuperBi1Semestre?: number;
  pontosSuperBi2Semestre?: number;
  numeradorDescricao?: string;
  denominadorDescricao?: string;
  farolVerdeCriterio?: string;
  portalOficial?: string;
}

export interface PlatformDataRecord {
  id: string;
  platformId: string;
  uploadedAt: string;
  fileName: string;
  fileSize?: string;
  rowCount: number;
  currentValue: number;
  seducTarget: number;
  status: 'excelente' | 'atencao' | 'critico' | 'pendente';
  summaryText: string;
  turmasBreakdown?: {
    turma: string;
    valor: number;
    totalAlunos: number;
    alunosAtingiramMeta: number;
  }[];
  criticalAlerts?: string[];
  keyInsights?: string[];
  rawTablePreview?: Record<string, any>[];
}

export interface SchoolProfile {
  nome: string;
  codCIE: string;
  diretoriaEnsino: string;
  municipio: string;
  modelo: 'PEI_9H' | 'PEI_7H' | 'REGULAR';
  segmentos: string[];
  totalAlunos: number;
  totalTurmas: number;
  totalDocentes: number;
  anoLetivo: number;
  bimestreReferencia: string;
}

export interface TurmaPerformance {
  turma: string;
  segmento: 'Anos Iniciais' | 'Anos Finais' | 'Ensino Médio';
  totalAlunos: number;
  frequenciaMedia: number;
  tarefaSpAdesao: number;
  redacaoEntregas: number;
  provaPaulistaAcertos: number;
  plataformasAdesaoGeral: number;
  statusGeral: 'excelente' | 'atencao' | 'critico';
}

export interface ActionPlanItem {
  id: string;
  origem: string;
  problema: string;
  causaRaiz: string;
  acaoProposta: string;
  responsavel: string;
  prazo: string;
  indicadorMeta: string;
  status: 'nao_iniciado' | 'em_andamento' | 'concluido';
  prioridade: 'alta' | 'media' | 'baixa';
}

export interface HistoricalSnapshot {
  id: string;
  title: string;
  periodo: string;
  savedAt: string;
  scoreGeral: number;
  classificacao: string;
  platformRecords: Record<string, PlatformDataRecord>;
  turmas: TurmaPerformance[];
  actionPlan: ActionPlanItem[];
  schoolProfile: SchoolProfile;
  observacoes?: string;
}

export interface DiagnosticPanorama {
  schoolProfile: SchoolProfile;
  totalPlatforms: number;
  loadedPlatformsCount: number;
  scoreGeralEscola: number;
  classificacaoEscola: 'Excelência PEI' | 'Consolidado' | 'Em Desenvolvimento' | 'Atenção Prioritária' | 'Aguardando Dados';
  eixosScores: {
    avaliacoes: number;
    plataformasDigitais: number;
    frequencia: number;
    gestaoDocente: number;
    modeloPeiFuturo: number;
    infraestrutura: number;
  };
  destaquesPositivos: string[];
  vulnerabilidadesCriticas: string[];
  correlacoesChave: {
    titulo: string;
    descricao: string;
    grau: 'forte' | 'moderada' | 'fraca';
    impacto: string;
  }[];
  turmasRanking: TurmaPerformance[];
  planoAcaoMMR: ActionPlanItem[];
}
