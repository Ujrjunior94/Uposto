import type { RegistroImportadoReconhecido } from './importadorEscalaImagemService';

// The existing repository commits at most 400 documents in one atomic batch.
// Larger imports must declare a smaller period rather than risk partially committed chunks.
export const MAX_CELULAS_IMPORTACAO = 400;

/** Declared by the user, never inferred from the cells that survived OCR. */
export interface EscopoImportacaoEscala {
  funcionarioIds: string[];
  primeiroDia: number;
  ultimoDia: number;
}

export function conferirMatrizImportacao(
  records: RegistroImportadoReconhecido[],
  scope: EscopoImportacaoEscala,
  totalDays: number,
) {
  const ids = new Set(scope.funcionarioIds);
  const escopoValido = Number.isInteger(totalDays) && totalDays >= 1 && totalDays <= 31 &&
    ids.size > 0 && ids.size <= 100 && ids.size === scope.funcionarioIds.length &&
    scope.funcionarioIds.every(id => typeof id === 'string' && id.trim().length > 0) &&
    Number.isInteger(scope.primeiroDia) && Number.isInteger(scope.ultimoDia) &&
    scope.primeiroDia >= 1 && scope.ultimoDia <= totalDays && scope.primeiroDia <= scope.ultimoDia;
  const counts = new Map<string, number>();
  let foraDoEscopo = 0;
  let pendentes = 0;
  for (const record of records) {
    if (record.status !== 'CONFIRMADO') pendentes++;
    if (!ids.has(record.employeeId || '') || !Number.isInteger(record.day) ||
      record.day < scope.primeiroDia || record.day > scope.ultimoDia) {
      foraDoEscopo++;
      continue;
    }
    const key = `${record.employeeId}:${record.day}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const faltantes: { funcionarioId: string; dia: number }[] = [];
  let duplicadas = 0;
  if (escopoValido) {
    for (const funcionarioId of ids) {
      for (let dia = scope.primeiroDia; dia <= scope.ultimoDia; dia++) {
        const count = counts.get(`${funcionarioId}:${dia}`) || 0;
        if (count === 0) faltantes.push({ funcionarioId, dia });
        if (count > 1) duplicadas += count - 1;
      }
    }
  }
  const esperados = escopoValido ? ids.size * (scope.ultimoDia - scope.primeiroDia + 1) : 0;
  return {
    escopoValido,
    esperados,
    limiteExcedido: esperados > MAX_CELULAS_IMPORTACAO,
    recebidos: counts.size,
    faltantes,
    duplicadas,
    foraDoEscopo,
    pendentes,
    completa: escopoValido && esperados <= MAX_CELULAS_IMPORTACAO && records.length === esperados && counts.size === esperados &&
      faltantes.length === 0 && duplicadas === 0 && foraDoEscopo === 0 && pendentes === 0,
  };
}
