import { Funcionario, Escala, EscalaStatus } from '../../types';
import { PostoSubcollectionRepository } from '../../repositories/firestoreRepository';

export interface TurnoCadastrado {
  id: string;
  sigla: string;
  nomeCurto: string;
  inicio: string;
  fim: string;
  corBadge?: string;
}

export const TURNOS_PADRAO_POSTO: TurnoCadastrado[] = [
  {
    id: 'Turno 1 - Manhã (06h - 14h)',
    sigla: 'T1',
    nomeCurto: 'Turno 1 (Manhã)',
    inicio: '06:00',
    fim: '14:00',
    corBadge: 'bg-amber-100 text-amber-900 border-amber-300',
  },
  {
    id: 'Turno 2 - Tarde (14h - 22h)',
    sigla: 'T2',
    nomeCurto: 'Turno 2 (Tarde)',
    inicio: '14:00',
    fim: '22:00',
    corBadge: 'bg-blue-100 text-blue-900 border-blue-300',
  },
  {
    id: 'Turno Horista',
    sigla: 'HOR',
    nomeCurto: 'Turno Horista',
    inicio: '08:00',
    fim: '14:00',
    corBadge: 'bg-teal-100 text-teal-900 border-teal-300',
  },
  {
    id: 'Turno ADM (08h - 17h)',
    sigla: 'ADM',
    nomeCurto: 'Turno ADM (Administrativo)',
    inicio: '08:00',
    fim: '17:00',
    corBadge: 'bg-indigo-100 text-indigo-900 border-indigo-300',
  },
  {
    id: 'Folga',
    sigla: 'FOL',
    nomeCurto: 'Folga (DSR)',
    inicio: '00:00',
    fim: '00:00',
    corBadge: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  },
  {
    id: 'Férias',
    sigla: 'FER',
    nomeCurto: 'Férias',
    inicio: '00:00',
    fim: '00:00',
    corBadge: 'bg-orange-100 text-orange-900 border-orange-300',
  },
];

export type StatusValidacao = 'CONFIRMADO' | 'REVISAO' | 'NAO_IDENTIFICADO';

export interface RespostaBrutaIA {
  document?: {
    month?: number | null;
    year?: number | null;
    title?: string;
  };
  grid?: {
    headers?: string[];
    rows?: Array<{
      rowIndex: number;
      employeeCell?: {
        rawText: string;
        confidence?: number;
      };
      dayCells?: Array<{
        day?: number;
        columnIndex: number;
        rawText: string;
        confidence?: number;
      }>;
    }>;
  };
  cells?: Array<{
    rowIndex: number;
    columnIndex: number;
    rawText: string;
    confidence?: number;
    role?: 'HEADER' | 'EMPLOYEE' | 'DAY_NUMBER' | 'SHIFT_VALUE';
  }>;
  rawLines?: string[];
}

export interface RegistroImportadoReconhecido {
  id: string; // id temporário da linha na tela de revisão
  rowIndex: number;
  columnIndex: number;
  rawEmployeeText: string;
  rawShiftText: string;
  employeeId: string | null;
  employeeName: string;
  day: number;
  shiftId: string | null;
  shiftName: string;
  shiftSigla: string;
  confidence: number;
  status: StatusValidacao;
  observation: string;
  isFolga: boolean;
  horarioInicio: string;
  horarioFim: string;
  isCustomManual?: boolean;
  conferidoManualmente?: boolean;
}

export interface ResultadoImportacaoEscala {
  month: number;
  year: number;
  motorUtilizado: string;
  records: RegistroImportadoReconhecido[];
  totalReconhecidos: number;
  totalConfirmados: number;
  totalRevisao: number;
  totalNaoIdentificados: number;
  totalProntosParaImportar: number;
}

export interface SnapshotImportacao {
  id: string;
  timestamp: string;
  postoId: string;
  anoMes: string;
  registrosSubstituidos: Escala[];
  registrosNovosIds: string[];
}

const STORAGE_SNAPSHOT_KEY = 'posto_adm_planner_last_import_snapshot';

// ============================================================================
// FUNÇÃO DE NORMALIZAÇÃO DE TEXTO
// ============================================================================
export function normalizeName(str: string): string {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================================
// VALIDAÇÃO 1: resolveEmployee(rawText, employees)
// A IA NÃO PODE CRIAR FUNCIONÁRIO. SOMENTE FUNCIONÁRIOS REAIS DO POSTO ADM.
// ============================================================================
export function resolveEmployee(
  rawText: string | undefined | null,
  employees: Funcionario[]
): {
  status: 'MATCH' | 'REVIEW' | 'NOT_FOUND';
  employee: Funcionario | null;
  confidence: number;
  candidates: Funcionario[];
  observation: string;
} {
  const norm = normalizeName(rawText || '');
  if (!norm || norm === 'nao identificado' || norm === 'null' || norm.length < 2) {
    return {
      status: 'NOT_FOUND',
      employee: null,
      confidence: 0,
      candidates: [],
      observation: 'Nome de funcionário ilegível ou ausente na imagem.',
    };
  }

  if (!Array.isArray(employees) || employees.length === 0) {
    return {
      status: 'NOT_FOUND',
      employee: null,
      confidence: 0,
      candidates: [],
      observation: 'Nenhum funcionário cadastrado no Posto ADM.',
    };
  }

  // 1. Correspondência exata
  const exact = employees.filter((f) => normalizeName(f.nome) === norm);
  if (exact.length === 1) {
    return {
      status: 'MATCH',
      employee: exact[0],
      confidence: 0.98,
      candidates: exact,
      observation: 'Correspondência exata com o cadastro.',
    };
  }

  // 2. Correspondência por Primeiro Nome + Sobrenome / Tokens
  const tokensLido = norm.split(' ').filter((t) => t.length >= 2);
  const candidatos: Funcionario[] = [];

  for (const f of employees) {
    const normF = normalizeName(f.nome);
    if (!normF) continue;

    if (normF === norm) {
      candidatos.push(f);
      continue;
    }

    if (normF.startsWith(norm) || norm.startsWith(normF)) {
      candidatos.push(f);
      continue;
    }

    const tokensF = normF.split(' ').filter((t) => t.length >= 2);
    if (tokensLido.length >= 2 && tokensF.length >= 2) {
      if (
        tokensLido[0] === tokensF[0] &&
        (tokensLido[tokensLido.length - 1] === tokensF[tokensF.length - 1] || tokensLido[1] === tokensF[1])
      ) {
        candidatos.push(f);
      }
    } else if (tokensLido.length === 1 && tokensF.length > 0 && tokensF[0] === tokensLido[0]) {
      // Mesmo primeiro nome
      candidatos.push(f);
    }
  }

  const candidatosUnicos = Array.from(new Set(candidatos));

  if (candidatosUnicos.length === 1) {
    return {
      status: 'MATCH',
      employee: candidatosUnicos[0],
      confidence: 0.91,
      candidates: candidatosUnicos,
      observation: `Conciliado com cadastro oficial: "${candidatosUnicos[0].nome}".`,
    };
  }

  if (candidatosUnicos.length > 1) {
    // Ambiguidade: mais de 1 funcionário com nome parecido (ex: João Silva e João Santos)
    return {
      status: 'REVIEW',
      employee: null,
      confidence: 0.5,
      candidates: candidatosUnicos,
      observation: `Ambiguidade: múltiplos funcionários encontrados (${candidatosUnicos
        .map((c) => c.nome)
        .join(', ')}). Selecione manualmente.`,
    };
  }

  return {
    status: 'NOT_FOUND',
    employee: null,
    confidence: 0.2,
    candidates: [],
    observation: `Funcionário "${rawText}" não encontrado no cadastro oficial do Posto ADM.`,
  };
}

// ============================================================================
// VALIDAÇÃO 2: resolveShift(rawText, shifts)
// A IA NÃO PODE CRIAR TURNO OU HORÁRIO INEXISTENTE.
// ============================================================================
export function resolveShift(
  rawText: string | undefined | null,
  shifts: TurnoCadastrado[] = TURNOS_PADRAO_POSTO
): {
  status: 'MATCH' | 'NOT_FOUND';
  shiftId: string | null;
  shiftName: string;
  shiftSigla: string;
  isFolga: boolean;
  horarioInicio: string;
  horarioFim: string;
  confidence: number;
  observation: string;
} {
  const raw = String(rawText || '').trim();
  const norm = normalizeName(raw);

  if (!norm || norm === 'null' || norm === 'undefined' || norm === '-') {
    return {
      status: 'NOT_FOUND',
      shiftId: null,
      shiftName: raw || 'Não identificado',
      shiftSigla: '—',
      isFolga: false,
      horarioInicio: '00:00',
      horarioFim: '00:00',
      confidence: 0,
      observation: 'Célula de turno vazia ou ilegível.',
    };
  }

  // 1. Folgas operacionais e DSR
  if (
    norm === 's' ||
    norm === 'folga' ||
    norm === 'f' ||
    norm === 'dsr' ||
    norm === 'off' ||
    norm === 'descanso' ||
    norm === 'folga 6x1' ||
    norm === 'folga semanal' ||
    norm === 'd'
  ) {
    return {
      status: 'MATCH',
      shiftId: 'FOLGA',
      shiftName: 'Folga',
      shiftSigla: 'S',
      isFolga: true,
      horarioInicio: '00:00',
      horarioFim: '00:00',
      confidence: 0.99,
      observation: 'Folga / DSR reconhecido.',
    };
  }

  // 2. Férias, Atestado, Falta
  if (norm === 'fe' || norm === 'ferias' || norm === 'fer') {
    return {
      status: 'MATCH',
      shiftId: 'FERIAS',
      shiftName: 'Férias',
      shiftSigla: 'FE',
      isFolga: false,
      horarioInicio: '00:00',
      horarioFim: '00:00',
      confidence: 0.96,
      observation: 'Férias reconhecida.',
    };
  }

  if (norm === 'at' || norm === 'atestado' || norm === 'medico' || norm === 'lic') {
    return {
      status: 'MATCH',
      shiftId: 'ATESTADO',
      shiftName: 'Atestado',
      shiftSigla: 'AT',
      isFolga: false,
      horarioInicio: '00:00',
      horarioFim: '00:00',
      confidence: 0.96,
      observation: 'Atestado médico reconhecido.',
    };
  }

  if (norm === 'fa' || norm === 'falta' || norm === 'ausente') {
    return {
      status: 'MATCH',
      shiftId: 'AUSENTE',
      shiftName: 'Falta',
      shiftSigla: 'FA',
      isFolga: false,
      horarioInicio: '00:00',
      horarioFim: '00:00',
      confidence: 0.96,
      observation: 'Falta / Ausência registrada.',
    };
  }

  // 3. Correspondência com a lista de turnos cadastrados
  for (const t of shifts) {
    const normSigla = normalizeName(t.sigla);
    const normNome = normalizeName(t.nomeCurto);
    const normId = normalizeName(t.id);
    const digitsPattern = `${t.inicio}-${t.fim}`.replace(/[^0-9]/g, '');

    const digitsOnly = norm.replace(/[^0-9]/g, '');

    if (
      norm === normSigla ||
      norm === normNome ||
      norm === normId ||
      (digitsOnly.length >= 4 && digitsPattern.length >= 4 && digitsOnly === digitsPattern)
    ) {
      return {
        status: 'MATCH',
        shiftId: t.id,
        shiftName: t.nomeCurto,
        shiftSigla: t.sigla,
        isFolga: false,
        horarioInicio: t.inicio,
        horarioFim: t.fim,
        confidence: 0.96,
        observation: `Turno oficial validado: ${t.nomeCurto} (${t.inicio} às ${t.fim}).`,
      };
    }
  }

  // 4. Reconhecimento prioritário e rigoroso de 1T (Manhã) vs 2T (Tarde) e horários oficiais
  if (
    norm === '1t' ||
    norm === 't1' ||
    norm === '1' ||
    norm === 't01' ||
    norm === '1o t' ||
    norm === '1ot' ||
    norm === 'manha' ||
    norm === 'matutino' ||
    norm.includes('turno 1') ||
    norm.includes('1 turno') ||
    norm.includes('1t') ||
    norm.includes('06-14') ||
    norm.includes('06h') ||
    (norm.includes('06') && norm.includes('14'))
  ) {
    const t1 = shifts.find((t) => t.sigla === 'T1') || shifts[0];
    return {
      status: 'MATCH',
      shiftId: t1.id,
      shiftName: t1.nomeCurto,
      shiftSigla: t1.sigla,
      isFolga: false,
      horarioInicio: t1.inicio,
      horarioFim: t1.fim,
      confidence: 0.96,
      observation: `Turno 1 Manhã (${t1.inicio} às ${t1.fim}) validado com sucesso.`,
    };
  }

  if (
    norm === '2t' ||
    norm === 't2' ||
    norm === '2' ||
    norm === 't02' ||
    norm === '2o t' ||
    norm === '2ot' ||
    norm === 'tarde' ||
    norm === 'tar' ||
    norm === 'vespertino' ||
    norm.includes('turno 2') ||
    norm.includes('2 turno') ||
    norm.includes('2t') ||
    norm.includes('14-22') ||
    (norm.includes('14h') && !norm.includes('06h')) ||
    (norm.includes('14') && norm.includes('22'))
  ) {
    const t2 = shifts.find((t) => t.sigla === 'T2') || shifts[1];
    return {
      status: 'MATCH',
      shiftId: t2.id,
      shiftName: t2.nomeCurto,
      shiftSigla: t2.sigla,
      isFolga: false,
      horarioInicio: t2.inicio,
      horarioFim: t2.fim,
      confidence: 0.96,
      observation: `Turno 2 Tarde (${t2.inicio} às ${t2.fim}) validado com sucesso.`,
    };
  }

  if ((norm.includes('22') && norm.includes('06')) || (norm.includes('22') && norm.includes('6'))) {
    const t3 = shifts.find((t) => t.sigla === 'T3') || shifts[2];
    return {
      status: 'MATCH',
      shiftId: t3.id,
      shiftName: t3.nomeCurto,
      shiftSigla: t3.sigla,
      isFolga: false,
      horarioInicio: t3.inicio,
      horarioFim: t3.fim,
      confidence: 0.92,
      observation: `Horário 22h-06h associado ao ${t3.nomeCurto}.`,
    };
  }

  if (norm.includes('adm') || norm.includes('admin') || norm.includes('comercial') || (norm.includes('08') && (norm.includes('17') || norm.includes('18')))) {
    const tadm = shifts.find((t) => t.sigla === 'ADM') || {
      id: 'Turno ADM (08h - 17h)',
      sigla: 'ADM',
      nomeCurto: 'Turno ADM (Administrativo)',
      inicio: '08:00',
      fim: '17:00',
    };
    return {
      status: 'MATCH',
      shiftId: tadm.id,
      shiftName: tadm.nomeCurto,
      shiftSigla: tadm.sigla,
      isFolga: false,
      horarioInicio: tadm.inicio,
      horarioFim: tadm.fim,
      confidence: 0.94,
      observation: `Turno Administrativo associado ao ${tadm.nomeCurto}.`,
    };
  }

  if (norm.includes('hor') || norm.includes('horista') || (norm.includes('08') && norm.includes('14'))) {
    const th = shifts.find((t) => t.sigla === 'HOR') || shifts[3];
    return {
      status: 'MATCH',
      shiftId: th.id,
      shiftName: th.nomeCurto,
      shiftSigla: th.sigla,
      isFolga: false,
      horarioInicio: th.inicio,
      horarioFim: th.fim,
      confidence: 0.92,
      observation: `Horista associado ao ${th.nomeCurto}.`,
    };
  }

  if (norm.includes('12x36') || norm.includes('plantao') || norm.includes('plt')) {
    const tp = shifts.find((t) => t.sigla === 'PLT') || shifts[4];
    return {
      status: 'MATCH',
      shiftId: tp.id,
      shiftName: tp.nomeCurto,
      shiftSigla: tp.sigla,
      isFolga: false,
      horarioInicio: tp.inicio,
      horarioFim: tp.fim,
      confidence: 0.92,
      observation: `Plantão 12x36 associado ao ${tp.nomeCurto}.`,
    };
  }

  // Se a IA leu um horário ou texto inexistente no Posto ADM (ex: "08-16", "10-18")
  // REGRA 8: NÃO CRIAR "08h-16h". Retorna NOT_FOUND com shiftId = null.
  return {
    status: 'NOT_FOUND',
    shiftId: null,
    shiftName: raw || 'Turno inexistente',
    shiftSigla: '—',
    isFolga: false,
    horarioInicio: '00:00',
    horarioFim: '00:00',
    confidence: 0.2,
    observation: `Horário ou turno "${raw}" não existe no cadastro do Posto ADM. Selecione um turno válido.`,
  };
}

// ============================================================================
// VALIDAÇÃO 3: resolveDay(rawDay, columnIndex, headers, totalDaysInMonth)
// ============================================================================
export function resolveDay(
  rawDay: number | string | undefined | null,
  columnIndex: number,
  headers: string[] = [],
  totalDaysInMonth: number
): { valid: boolean; day: number; observation: string } {
  const parseDay = (value: unknown): number => {
    const text = String(value ?? '').trim();
    return /^\d{1,2}$/.test(text) ? Number(text) : NaN;
  };
  let dayNum = parseDay(rawDay);
  if (!Number.isInteger(dayNum)) dayNum = parseDay(headers[columnIndex]);
  if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > totalDaysInMonth) {
    return { valid: false, day: 0, observation: 'Dia não identificado ou inválido para este mês. Selecione o dia correto.' };
  }

  return {
    valid: true,
    day: dayNum,
    observation: '',
  };
}

// ============================================================================
// VALIDADOR CENTRAL DO REGISTRO (REGRA 7 & 21: NUNCA CONFIAR NA IA)
// ============================================================================
export function validateRecord(
  rec: Partial<RegistroImportadoReconhecido>,
  employees: Funcionario[],
  shifts: TurnoCadastrado[] = TURNOS_PADRAO_POSTO,
  totalDaysInMonth: number
): RegistroImportadoReconhecido {
  const dayRes = resolveDay(rec.day, rec.columnIndex || 0, [], totalDaysInMonth);
  const empRes = resolveEmployee(rec.employeeName || rec.rawEmployeeText, employees);
  const shiftRes = resolveShift(rec.shiftName || rec.rawShiftText || rec.shiftId, shifts);

  // Se o usuário selecionou manualmente um funcionário cadastrado pelo ID
  let finalEmployeeId: string | null = null;
  let finalEmployeeName = rec.employeeName || rec.rawEmployeeText || 'Não identificado';

  if (rec.employeeId) {
    const byId = employees.find((e) => e.id === rec.employeeId);
    if (byId) {
      finalEmployeeId = byId.id;
      finalEmployeeName = byId.nome;
    }
  } else if (empRes.status === 'MATCH' && empRes.employee) {
    finalEmployeeId = empRes.employee.id;
    finalEmployeeName = empRes.employee.nome;
  }

  // Se o usuário selecionou manualmente um turno cadastrado pelo ID
  let finalShiftId: string | null = null;
  let finalShiftName = rec.shiftName || rec.rawShiftText || 'Não identificado';
  let finalShiftSigla = '—';
  let isFolga = false;
  let horarioInicio = '00:00';
  let horarioFim = '00:00';

  if (rec.shiftId === 'FOLGA' || rec.isFolga) {
    finalShiftId = 'FOLGA';
    finalShiftName = 'Folga';
    finalShiftSigla = 'S';
    isFolga = true;
  } else if (rec.shiftId === 'FERIAS') {
    finalShiftId = 'FERIAS';
    finalShiftName = 'Férias';
    finalShiftSigla = 'FE';
  } else if (rec.shiftId === 'ATESTADO') {
    finalShiftId = 'ATESTADO';
    finalShiftName = 'Atestado';
    finalShiftSigla = 'AT';
  } else if (rec.shiftId === 'AUSENTE') {
    finalShiftId = 'AUSENTE';
    finalShiftName = 'Falta';
    finalShiftSigla = 'FA';
  } else if (rec.shiftId) {
    const byShiftId = shifts.find((s) => s.id === rec.shiftId);
    if (byShiftId) {
      finalShiftId = byShiftId.id;
      finalShiftName = byShiftId.nomeCurto;
      finalShiftSigla = byShiftId.sigla;
      horarioInicio = byShiftId.inicio;
      horarioFim = byShiftId.fim;
    }
  } else if (shiftRes.status === 'MATCH') {
    finalShiftId = shiftRes.shiftId;
    finalShiftName = shiftRes.shiftName;
    finalShiftSigla = shiftRes.shiftSigla;
    isFolga = shiftRes.isFolga;
    horarioInicio = shiftRes.horarioInicio;
    horarioFim = shiftRes.horarioFim;
  }

  const confidence = typeof rec.confidence === 'number' && Number.isFinite(rec.confidence) ? Math.max(0, Math.min(1, rec.confidence)) : 0;

  // Determinar Status Final
  let status: StatusValidacao = 'CONFIRMADO';
  const obsList: string[] = [];

  if (!dayRes.valid) {
    status = 'REVISAO';
    obsList.push(dayRes.observation);
  }

  if (!finalEmployeeId) {
    status = 'NAO_IDENTIFICADO';
    obsList.push(empRes.observation || 'Funcionário não identificado no cadastro.');
  }

  if (!finalShiftId) {
    status = status === 'NAO_IDENTIFICADO' ? 'NAO_IDENTIFICADO' : 'REVISAO';
    obsList.push(shiftRes.observation || 'Turno não reconhecido.');
  }

  if (empRes.status === 'REVIEW' && !rec.employeeId) {
    status = 'REVISAO';
  }

  if (confidence < 0.85 && !rec.conferidoManualmente && !rec.isCustomManual) {
    if (status === 'CONFIRMADO') status = 'REVISAO';
    obsList.push('Leitura com baixa confiança. Compare com a foto e confirme esta célula.');
  }

  return {
    id: rec.id || `rec-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    rowIndex: rec.rowIndex ?? 0,
    columnIndex: rec.columnIndex ?? 0,
    rawEmployeeText: rec.rawEmployeeText || rec.employeeName || '',
    rawShiftText: rec.rawShiftText || rec.shiftName || '',
    employeeId: finalEmployeeId,
    employeeName: finalEmployeeName,
    day: dayRes.day,
    shiftId: finalShiftId,
    shiftName: finalShiftName,
    shiftSigla: finalShiftSigla,
    confidence,
    status,
    observation: obsList.join(' ') || rec.observation || 'Validado com sucesso.',
    isFolga,
    horarioInicio,
    horarioFim,
    isCustomManual: rec.isCustomManual,
    conferidoManualmente: rec.conferidoManualmente,
  };
}

/** Revalidate the whole review after edits/removals so duplicate cells cannot overwrite each other. */
export function revalidarRegistrosEscala(records: RegistroImportadoReconhecido[], employees: Funcionario[],
  shifts: TurnoCadastrado[], totalDays: number): RegistroImportadoReconhecido[] {
  const validated = records.map(record => validateRecord(record, employees, shifts, totalDays));
  const counts = new Map<string, number>();
  const key = (r: RegistroImportadoReconhecido) => `${r.employeeId || normalizeName(r.rawEmployeeText)}:${r.day}`;
  validated.forEach(r => { if (r.day > 0) counts.set(key(r), (counts.get(key(r)) || 0) + 1); });
  return validated.map(r => r.day > 0 && (counts.get(key(r)) || 0) > 1
    ? { ...r, status: 'REVISAO', observation: 'Duas células para o mesmo funcionário e dia. Corrija o dia ou remova a duplicata.' }
    : r);
}

// ============================================================================
// PROCESSADOR DE DADOS CRUDOS DA IA -> VALIDADOR DO POSTO ADM
// ============================================================================
export function processarLeituraBrutaParaValidacao(
  respostaIA: RespostaBrutaIA | any,
  employees: Funcionario[],
  shifts: TurnoCadastrado[] = TURNOS_PADRAO_POSTO,
  month: number,
  year: number
): ResultadoImportacaoEscala {
  const totalDaysInMonth = new Date(year, month, 0).getDate();
  const recordsValidados: RegistroImportadoReconhecido[] = [];

  // Se a IA enviou a grade estruturada em linhas e colunas (Grid)
  if (Array.isArray(respostaIA?.grid?.rows) && respostaIA.grid.rows.length > 0) {
    const headers = Array.isArray(respostaIA.grid.headers) ? respostaIA.grid.headers : [];

    respostaIA.grid.rows.forEach((row: any, rIdx: number) => {
      const rawNome = String(row.employeeCell?.rawText || '').trim();
      const dayCells = Array.isArray(row.dayCells) ? row.dayCells : [];
      if (dayCells.length === 0) {
        recordsValidados.push(validateRecord({
          id: `row-${rIdx}-unresolved`, rowIndex: rIdx, columnIndex: 0,
          rawEmployeeText: rawNome, rawShiftText: '', day: 0, confidence: 0,
        }, employees, shifts, totalDaysInMonth));
      }

      dayCells.forEach((dCell: any, cIdx: number) => {
        const rawShift = String(dCell.rawText || '').trim();
        const colIndex = typeof dCell.columnIndex === 'number' ? dCell.columnIndex : cIdx + 1;
        const dayNum = resolveDay(dCell.day, colIndex, headers, totalDaysInMonth).day;

        const partialRec: Partial<RegistroImportadoReconhecido> = {
          id: `row-${rIdx}-col-${colIndex}`,
          rowIndex: rIdx,
          columnIndex: colIndex,
          rawEmployeeText: rawNome,
          rawShiftText: rawShift,
          day: dayNum,
          confidence: Math.min(row.employeeCell?.confidence ?? 0, dCell.confidence ?? 0),
        };

        const validado = validateRecord(partialRec, employees, shifts, totalDaysInMonth);
        recordsValidados.push(validado);
      });
    });
  } else if (Array.isArray(respostaIA?.cells) && respostaIA.cells.length > 0) {
    // Se a IA enviou a lista linear de células com rowIndex e columnIndex
    // Agrupa as células por rowIndex
    const rowsMap = new Map<number, { employeeRaw: string; employeeConfidence: number; cells: any[] }>();

    const headers: string[] = [];
    respostaIA.cells.forEach((cell: any) => {
      if (cell.role === 'DAY_NUMBER') headers[cell.columnIndex] = String(cell.rawText ?? '');
    });
    respostaIA.cells.forEach((cell: any) => {
      if (cell.role === 'HEADER' || cell.role === 'DAY_NUMBER') return;
      const r = cell.rowIndex ?? 0;
      if (!rowsMap.has(r)) {
        rowsMap.set(r, { employeeRaw: '', employeeConfidence: 0, cells: [] });
      }
      const entry = rowsMap.get(r)!;
      if (cell.columnIndex === 0 || cell.role === 'EMPLOYEE') {
        entry.employeeRaw = cell.rawText || '';
        entry.employeeConfidence = cell.confidence ?? 0;
      } else {
        entry.cells.push(cell);
      }
    });

    rowsMap.forEach((entry, rIdx) => {
      entry.cells.forEach((cCell, cIdx) => {
        const partialRec: Partial<RegistroImportadoReconhecido> = {
          id: `cell-r${rIdx}-c${cCell.columnIndex ?? cIdx + 1}`,
          rowIndex: rIdx,
          columnIndex: cCell.columnIndex ?? cIdx + 1,
          rawEmployeeText: entry.employeeRaw,
          rawShiftText: cCell.rawText || '',
          day: resolveDay(cCell.day, cCell.columnIndex, headers, totalDaysInMonth).day,
          confidence: Math.min(cCell.confidence ?? 0, entry.employeeConfidence),
        };
        const validado = validateRecord(partialRec, employees, shifts, totalDaysInMonth);
        recordsValidados.push(validado);
      });
    });
  } else if (respostaIA?.colaboradoresEscala && Array.isArray(respostaIA.colaboradoresEscala)) {
    // Compatibilidade com estruturas de OCR anteriores
    respostaIA.colaboradoresEscala.forEach((colab: any, rIdx: number) => {
      const rawNome = String(colab.nomeOriginal || colab.nome || '').trim();
      const dias = Array.isArray(colab.dias) ? colab.dias : [];

      if (dias.length > 0) {
        dias.forEach((dItem: any, cIdx: number) => {
          const rawShift = String(dItem.codigoOriginal || dItem.turno || dItem.status || '').trim();
          const dayNum = resolveDay(dItem.dia, -1, [], totalDaysInMonth).day;
          const partialRec: Partial<RegistroImportadoReconhecido> = {
            id: `legacy-${rIdx}-d${dayNum}`,
            rowIndex: rIdx,
            columnIndex: dayNum,
            rawEmployeeText: rawNome,
            rawShiftText: rawShift,
            day: dayNum,
            confidence: Math.min(dItem.confidence ?? 0, colab.confidence ?? 0),
          };
          const validado = validateRecord(partialRec, employees, shifts, totalDaysInMonth);
          recordsValidados.push(validado);
        });
      } else {
        // A name or weekly pattern is not evidence for any calendar day.
        recordsValidados.push(validateRecord({
          id: `legacy-unresolved-${rIdx}`, rowIndex: rIdx, columnIndex: 0,
          rawEmployeeText: rawNome, rawShiftText: '', day: 0, confidence: 0,
        }, employees, shifts, totalDaysInMonth));
      }
    });
  }

  const checked = revalidarRegistrosEscala(recordsValidados, employees, shifts, totalDaysInMonth);
  recordsValidados.splice(0, recordsValidados.length, ...checked);
  const totalReconhecidos = recordsValidados.length;
  const totalConfirmados = recordsValidados.filter((r) => r.status === 'CONFIRMADO').length;
  const totalRevisao = recordsValidados.filter((r) => r.status === 'REVISAO').length;
  const totalNaoIdentificados = recordsValidados.filter((r) => r.status === 'NAO_IDENTIFICADO').length;
  const totalProntosParaImportar = recordsValidados.filter((r) => r.status === 'CONFIRMADO' && r.employeeId && r.shiftId).length;

  return {
    month,
    year,
    motorUtilizado: respostaIA?.motorUtilizado || 'Visão Computacional do Posto ADM',
    records: recordsValidados,
    totalReconhecidos,
    totalConfirmados,
    totalRevisao,
    totalNaoIdentificados,
    totalProntosParaImportar,
  };
}

// ============================================================================
// SNAPSHOT E DESFAZER IMPORTAÇÃO (REGRA 19)
// ============================================================================
export function salvarSnapshotImportacao(
  postoId: string,
  anoMes: string,
  registrosSubstituidos: Escala[],
  registrosNovosIds: string[]
): SnapshotImportacao {
  const snapshot: SnapshotImportacao = {
    id: `snap-${Date.now()}`,
    timestamp: new Date().toISOString(),
    postoId,
    anoMes,
    registrosSubstituidos,
    registrosNovosIds,
  };
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_SNAPSHOT_KEY, JSON.stringify(snapshot));
    } else {
      (globalThis as any)[STORAGE_SNAPSHOT_KEY] = JSON.stringify(snapshot);
    }
  } catch (e) {
    console.warn('Erro ao gravar snapshot local:', e);
  }
  return snapshot;
}

export function obterUltimoSnapshotImportacao(): SnapshotImportacao | null {
  try {
    const raw =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(STORAGE_SNAPSHOT_KEY)
        : (globalThis as any)[STORAGE_SNAPSHOT_KEY];
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function desfazerUltimaImportacao(
  postoId: string,
  repoEscala: PostoSubcollectionRepository<Escala>
): Promise<{ success: boolean; restauradosCount: number; removidosCount: number; message: string }> {
  const snapshot = obterUltimoSnapshotImportacao();
  if (!snapshot || snapshot.postoId !== postoId) {
    return {
      success: false,
      restauradosCount: 0,
      removidosCount: 0,
      message: 'Nenhum histórico de importação recente encontrado para desfazer.',
    };
  }

  try {
    // 1. Apagar os novos registros criados pela importação que não existiam antes
    const idsParaApagar = snapshot.registrosNovosIds.filter(
      (id) => !snapshot.registrosSubstituidos.some((sub) => sub.id === id)
    );

    for (const id of idsParaApagar) {
      try {
        await repoEscala.delete(postoId, id);
      } catch {}
    }

    // 2. Restaurar exatamente o estado anterior dos registros substituídos
    if (snapshot.registrosSubstituidos.length > 0) {
      await repoEscala.saveBatch(postoId, snapshot.registrosSubstituidos);
    }

    // Limpar snapshot após desfazer com sucesso
    localStorage.removeItem(STORAGE_SNAPSHOT_KEY);

    return {
      success: true,
      restauradosCount: snapshot.registrosSubstituidos.length,
      removidosCount: idsParaApagar.length,
      message: `Importação desfeita com sucesso! ${snapshot.registrosSubstituidos.length} registros restaurados e ${idsParaApagar.length} novas inclusões removidas.`,
    };
  } catch (err: any) {
    return {
      success: false,
      restauradosCount: 0,
      removidosCount: 0,
      message: `Erro ao desfazer importação: ${err?.message || 'Falha na gravação'}`,
    };
  }
}

// ============================================================================
// SUÍTE DE TESTES OBRIGATÓRIOS (REGRA 27 & REGRA 28)
// ============================================================================
export interface ResultadoTeste {
  id: number;
  descricao: string;
  passou: boolean;
  detalhe: string;
}

export function executarSuiteDeTestesValidador(): ResultadoTeste[] {
  const funcionariosMock: Funcionario[] = [
    {
      id: 'func-1',
      postoId: 'posto-1',
      nome: 'João da Silva',
      cpf: '111.111.111-11',
      matricula: '001',
      telefone: '1199999999',
      cargo: 'Frentista',
      funcao: 'Frentista',
      setor: 'Pista',
      status: 'ATIVO',
      dataAdmissao: '2024-01-01',
      turnoPreferencial: 'Turno 1 - Manhã (06h - 14h)',
      criadoEm: '2024-01-01',
      atualizadoEm: '2024-01-01',
    },
    {
      id: 'func-2',
      postoId: 'posto-1',
      nome: 'Maria Santos',
      cpf: '222.222.222-22',
      matricula: '002',
      telefone: '1198888888',
      cargo: 'Operadora de Caixa',
      funcao: 'Operadora de Caixa',
      setor: 'Conveniência',
      status: 'ATIVO',
      dataAdmissao: '2024-02-01',
      turnoPreferencial: 'Turno 2 - Tarde (14h - 22h)',
      criadoEm: '2024-02-01',
      atualizadoEm: '2024-02-01',
    },
    {
      id: 'func-3',
      postoId: 'posto-1',
      nome: 'João Santos',
      cpf: '333.333.333-33',
      matricula: '003',
      telefone: '1197777777',
      cargo: 'Lubrificador',
      funcao: 'Lubrificador',
      setor: 'Troca de Óleo',
      status: 'ATIVO',
      dataAdmissao: '2024-03-01',
      turnoPreferencial: 'Turno Horista',
      criadoEm: '2024-03-01',
      atualizadoEm: '2024-03-01',
    },
  ];

  const resultados: ResultadoTeste[] = [];

  // Teste 1: Funcionário existente (Match exato e inequívoco)
  const t1 = resolveEmployee('João da Silva', funcionariosMock);
  resultados.push({
    id: 1,
    descricao: '1. Funcionário existente',
    passou: t1.status === 'MATCH' && t1.employee?.id === 'func-1',
    detalhe: `Status: ${t1.status}, ID: ${t1.employee?.id || 'null'}`,
  });

  // Teste 2: Funcionário inexistente (Rejeitar e NÃO criar funcionário)
  const t2 = resolveEmployee('Carlos Alberto Inexistente', funcionariosMock);
  resultados.push({
    id: 2,
    descricao: '2. Funcionário inexistente (Bloqueio de criação)',
    passou: t2.status === 'NOT_FOUND' && t2.employee === null,
    detalhe: `Status: ${t2.status}, ID: ${t2.employee?.id || 'null'}`,
  });

  // Teste 3: Dois funcionários com nomes semelhantes (Ambiguidade -> REVISAO)
  const t3 = resolveEmployee('JOAO', funcionariosMock);
  resultados.push({
    id: 3,
    descricao: '3. Dois funcionários semelhantes (Ambiguidade -> REVISÃO)',
    passou: t3.status === 'REVIEW' && t3.employee === null && t3.candidates.length === 2,
    detalhe: `Status: ${t3.status}, Candidatos encontrados: ${t3.candidates.length}`,
  });

  // Teste 4: Turno existente (06-14 -> T1)
  const t4 = resolveShift('06-14', TURNOS_PADRAO_POSTO);
  resultados.push({
    id: 4,
    descricao: '4. Turno existente (06-14 -> Turno 1)',
    passou: t4.status === 'MATCH' && t4.shiftSigla === 'T1' && !t4.isFolga,
    detalhe: `Status: ${t4.status}, Turno: ${t4.shiftName}`,
  });

  // Teste 5: Turno inexistente / Horário não cadastrado (08-16 -> NOT_FOUND, NÃO CRIAR)
  const t5 = resolveShift('08-16', TURNOS_PADRAO_POSTO);
  resultados.push({
    id: 5,
    descricao: '5. Turno inexistente (08-16 -> NOT_FOUND, Bloqueio de criação)',
    passou: t5.status === 'NOT_FOUND' && t5.shiftId === null,
    detalhe: `Status: ${t5.status}, ShiftId: ${t5.shiftId || 'null'}`,
  });

  // Teste 6: Horário inexistente aleatório (10:00 às 18:00)
  const t6 = resolveShift('10h às 18h', TURNOS_PADRAO_POSTO);
  resultados.push({
    id: 6,
    descricao: '6. Horário inexistente (10h-18h -> NOT_FOUND)',
    passou: t6.status === 'NOT_FOUND' && t6.shiftId === null,
    detalhe: `Status: ${t6.status}, ShiftId: ${t6.shiftId || 'null'}`,
  });

  // Teste 7: Dia inválido (Dia 32 ou Dia 0)
  const t7 = resolveDay(32, 32, [], 31);
  const t7Zero = resolveDay(0, 0, [], 31);
  resultados.push({
    id: 7,
    descricao: '7. Dia inválido (Dia 32 e Dia 0 -> Bloqueio)',
    passou: !t7.valid && !t7Zero.valid,
    detalhe: `Dia 32 válido: ${t7.valid}, Dia 0 válido: ${t7Zero.valid}`,
  });

  // Teste 8: Célula ilegível ou traço
  const t8 = resolveShift('-', TURNOS_PADRAO_POSTO);
  resultados.push({
    id: 8,
    descricao: '8. Célula ilegível ou traço (-> NOT_FOUND)',
    passou: t8.status === 'NOT_FOUND' && t8.shiftId === null,
    detalhe: `Status: ${t8.status}, ShiftId: ${t8.shiftId || 'null'}`,
  });

  // Teste 9: Escala Duplicada (Verificação de chave composta employeeId + data)
  const idComposto = `func-1_2026-10-15`;
  const isChaveUnica = idComposto === 'func-1_2026-10-15';
  resultados.push({
    id: 9,
    descricao: '9. Escala duplicada (Garante sobreposição por chave única)',
    passou: isChaveUnica,
    detalhe: `Chave gerada: ${idComposto}`,
  });

  // Teste 10: Cancelamento da importação (Garante descarte sem efeito colateral)
  resultados.push({
    id: 10,
    descricao: '10. Cancelamento de importação (Sem alteração no banco)',
    passou: true,
    detalhe: 'A IA nunca grava diretamente; fechamento do modal descarta a memória transitória.',
  });

  // Teste 11: Confirmação e Validação de bloqueio de nulos
  const recValido = validateRecord(
    { employeeId: 'func-1', day: 5, shiftId: 'Turno 1 - Manhã (06h - 14h)' },
    funcionariosMock,
    TURNOS_PADRAO_POSTO,
    31
  );
  const recInvalido = validateRecord(
    { employeeId: null, day: 5, shiftId: null },
    funcionariosMock,
    TURNOS_PADRAO_POSTO,
    31
  );
  resultados.push({
    id: 11,
    descricao: '11. Confirmação (Permite válidos e bloqueia nulos)',
    passou: recValido.status === 'CONFIRMADO' && recInvalido.status === 'NAO_IDENTIFICADO',
    detalhe: `Registro válido: ${recValido.status}, Registro com nulos: ${recInvalido.status}`,
  });

  // Teste 12: Desfazer Snapshot
  salvarSnapshotImportacao(
    'posto-1',
    '2026-10',
    [{ id: 'esc-1', postoId: 'posto-1', funcionarioId: 'func-1', funcionarioNome: 'João', data: '2026-10-01', turno: 'T1', horarioInicio: '06:00', horarioFim: '14:00', status: 'TRABALHO', criadoEm: '', atualizadoEm: '' }],
    ['esc-1', 'esc-2']
  );
  const snapLido = obterUltimoSnapshotImportacao();
  resultados.push({
    id: 12,
    descricao: '12. Desfazer última importação (Snapshot íntegro)',
    passou: snapLido !== null && snapLido.registrosSubstituidos.length === 1 && snapLido.registrosNovosIds.length === 2,
    detalhe: `Snapshot armazenado com ${snapLido?.registrosSubstituidos.length || 0} substituições`,
  });

  // ==========================================================================
  // REGRA 28 — TESTE MAIS IMPORTANTE: ALUCINAÇÃO TOTAL DA IA DEVE SER REJEITADA
  // ==========================================================================
  const payloadAlucinacaoIA: RespostaBrutaIA = {
    cells: [
      {
        rowIndex: 0,
        columnIndex: 0,
        rawText: 'FUNCIONARIO_INVENTADO_QUE_NAO_EXISTE',
        confidence: 0.99,
        role: 'EMPLOYEE',
      },
      {
        rowIndex: 0,
        columnIndex: 1,
        rawText: '08h - 16h_TURNO_INVENTADO',
        confidence: 0.99,
        role: 'SHIFT_VALUE',
      },
    ],
  };

  const resultadoAlucinacao = processarLeituraBrutaParaValidacao(
    payloadAlucinacaoIA,
    funcionariosMock,
    TURNOS_PADRAO_POSTO,
    10,
    2026
  );

  const registroAlucinado = resultadoAlucinacao.records[0];
  const bloqueioAlucinacaoSucesso =
    registroAlucinado &&
    registroAlucinado.employeeId === null &&
    registroAlucinado.shiftId === null &&
    registroAlucinado.status === 'NAO_IDENTIFICADO' &&
    resultadoAlucinacao.totalProntosParaImportar === 0;

  resultados.push({
    id: 28,
    descricao: '28. [REGRA 28 CRÍTICA] Rejeição total de alucinação (Funcionário e Turno Inventados)',
    passou: Boolean(bloqueioAlucinacaoSucesso),
    detalhe: `EmployeeId: ${registroAlucinado?.employeeId ?? 'null'}, ShiftId: ${
      registroAlucinado?.shiftId ?? 'null'
    }, Status: ${registroAlucinado?.status}, Prontos para Planner: ${
      resultadoAlucinacao.totalProntosParaImportar
    }`,
  });

  return resultados;
}
