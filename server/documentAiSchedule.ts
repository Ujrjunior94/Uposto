import { GoogleAuth } from 'google-auth-library';

export class DocumentAiError extends Error {
  constructor(message: string, public status = 422) { super(message); }
}

type Cell = { layout?: { textAnchor?: { textSegments?: { startIndex?: string | number; endIndex?: string | number }[] }; confidence?: number }; rowSpan?: number; colSpan?: number };
type Row = { cells?: Cell[] };
type Document = { text?: string; pages?: { tables?: { headerRows?: Row[]; bodyRows?: Row[] }[] }[] };
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
const isCode = (s: string) => /^(?:[12]T|T[12]|FOLGA|FERIAS|HORISTA|ADM)$/.test(normalize(s));
const dayNumber = (s: string): number | null => {
  const match = normalize(s).match(/^(0?[1-9]|[12]\d|3[01])\s*(?:[\s/.-]*(?:SEG|TER|QUA|QUI|SEX|SAB|DOM))?$/);
  return match ? Number(match[1]) : null;
};
function cellText(doc: Document, cell: Cell): string {
  const text = doc.text || '';
  return (cell.layout?.textAnchor?.textSegments || []).map(segment => {
    const start = Number(segment.startIndex || 0), end = Number(segment.endIndex);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length) throw new DocumentAiError('A leitura retornou posições de texto inválidas.');
    return text.slice(start, end);
  }).join('').replace(/\s+/g, ' ').trim();
}
const confidence = (cell: Cell) => Math.max(0, Math.min(1, Number.isFinite(cell.layout?.confidence) ? cell.layout!.confidence! : 0));
const unmerged = (cell: Cell) => (cell.colSpan ?? 1) === 1 && (cell.rowSpan ?? 1) === 1;

/** Transposes day rows to the existing Planner review format. Never derives days by position. */
export function parseDocumentAiSchedule(doc: Document) {
  const output: any[] = [];
  for (const page of doc.pages || []) for (const table of page.tables || []) {
    const rows = [...table.headerRows || [], ...table.bodyRows || []];
    const firstData = rows.findIndex(row => dayNumber(cellText(doc, row.cells?.[0] || {})) !== null);
    if (firstData <= 0) continue;
    // Employee headers must be immediately before the first explicit day.
    const headers = rows[firstData - 1].cells || [];
    if (headers.length < 2 || headers.length > 101 || headers.some(cell => !unmerged(cell))) continue;
    const names = headers.slice(1).map(cell => cellText(doc, cell));
    if (names.some(name => !name || isCode(name) || dayNumber(name) !== null)) continue;
    const employees = names.map((name, i) => ({ rowIndex: output.length + i, employeeCell: { rawText: name, confidence: confidence(headers[i + 1]) }, dayCells: [] as any[] }));
    const seenDays = new Set<number>();
    for (const row of rows.slice(firstData)) {
      const cells = row.cells || [];
      const day = dayNumber(cellText(doc, cells[0] || {}));
      if (day === null) {
        // A cell containing a shift without a legible day must never be silently dropped.
        if (cells.slice(1).some(cell => isCode(cellText(doc, cell)))) throw new DocumentAiError('Há turnos em uma linha cujo dia está ilegível. Confira a foto e tente novamente.');
        continue;
      }
      if (seenDays.has(day)) throw new DocumentAiError('A tabela contém dias repetidos. Confira a leitura antes de importar.');
      seenDays.add(day);
      if (cells.length !== headers.length || cells.some(cell => !unmerged(cell))) throw new DocumentAiError(`A linha do dia ${day} ficou desalinhada. Nenhum dado foi importado.`);
      cells.slice(1).forEach((cell, i) => {
        const rawText = cellText(doc, cell);
        employees[i].dayCells.push({ day, columnIndex: day, rawText, confidence: rawText ? Math.min(confidence(cell), confidence(cells[0])) : 0 });
      });
    }
    if (seenDays.size) output.push(...employees);
  }
  if (!output.length) throw new DocumentAiError('O leitor não encontrou uma tabela com nomes e dias. Envie a escala completa e mais nítida.');
  if (output.length > 100) throw new DocumentAiError('A leitura contém funcionários demais para uma única importação.');
  const months = ['JANEIRO','FEVEREIRO','MARCO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
  const visible = normalize(doc.text || '');
  const monthMatches = months.map((name, i) => new RegExp('\\b' + name + '\\b').test(visible) ? i + 1 : null).filter(value => value !== null);
  const years = [...new Set(visible.match(/\b20\d{2}\b/g) || [])];
  return { document: { month: monthMatches.length === 1 ? monthMatches[0] : null, year: years.length === 1 ? Number(years[0]) : null, title: 'Escala — Document AI' }, grid: { headers: ['Funcionário'], rows: output } };
}

export async function analyzeWithDocumentAi(image: { base64: string; mimeType: string }, request: typeof fetch = fetch) {
  const processor = process.env.DOCUMENT_AI_PROCESSOR_NAME || '';
  const match = processor.match(/^projects\/([a-zA-Z0-9_-]+)\/locations\/([a-z0-9-]+)\/processors\/([a-zA-Z0-9_-]+)$/);
  if (!match) throw new DocumentAiError('Configure o processador Form Parser do Document AI no servidor.', 503);
  let credentials: any;
  try { if (process.env.DOCUMENT_AI_CREDENTIALS_JSON) credentials = JSON.parse(process.env.DOCUMENT_AI_CREDENTIALS_JSON); }
  catch { throw new DocumentAiError('A credencial do Document AI está inválida no servidor.', 503); }
  const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  let token: string | null;
  try { token = await auth.getAccessToken(); }
  catch { throw new DocumentAiError('Não foi possível autenticar no Document AI. Confira a credencial do servidor.', 503); }
  if (!token) throw new DocumentAiError('O Document AI não forneceu autorização para a leitura.', 503);
  const location = match[2];
  const host = location === 'global' ? 'documentai.googleapis.com' : `${location}-documentai.googleapis.com`;
  let response: Response;
  try {
    response = await request(`https://${host}/v1/${processor}:process`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawDocument: { content: image.base64, mimeType: image.mimeType } }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch { throw new DocumentAiError('O Document AI não respondeu a tempo. Tente novamente.', 504); }
  if (!response.ok) throw new DocumentAiError(
    response.status === 429 ? 'O Document AI atingiu o limite de uso. Tente mais tarde.' :
    response.status === 403 ? 'O Document AI recusou o acesso. Confira API, permissões e faturamento no Google Cloud.' :
    response.status === 404 ? 'O processador Document AI não foi encontrado. Confira projeto, região e identificador.' :
    'O Document AI não conseguiu concluir a leitura.', response.status === 429 ? 429 : 502);
  const result = await response.json();
  return { success: true, data: parseDocumentAiSchedule(result.document || {}), motorUtilizado: 'Google Document AI · Form Parser' };
}
