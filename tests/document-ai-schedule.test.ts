import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocumentAiSchedule, analyzeWithDocumentAi } from '../server/documentAiSchedule.ts';
function fixture(matrix: string[][]) {
  let text = '';
  const rows = matrix.map(row => ({ cells: row.map(value => {
    const startIndex = text.length; text += value + '\n';
    return { layout: { textAnchor: { textSegments: [{ startIndex, endIndex: text.length }] }, confidence: .96 } };
  }) }));
  return { text, pages: [{ tables: [{ headerRows: rows.slice(0, 1), bodyRows: rows.slice(1) }] }] };
}
test('mantém 8 funcionários, 31 dias e 248 células, incluindo auxiliares', () => {
  const names = ['FABIO','ISMAEL','DIEGO','JUNIOR','DAVID','ROMILSON','MOABE','UBIRAJARA'];
  const doc = fixture([['OUTUBRO', ...names], ...Array.from({length:31},(_,i) => [String(i+1),...names.map((_,j)=>j===5?'FÉRIAS':j%2?'1T':'2T')])]);
  const rows = parseDocumentAiSchedule(doc).grid.rows;
  assert.equal(rows.length, 8); assert.equal(rows.flatMap(r=>r.dayCells).length,248);
  assert.deepEqual(rows.map(r=>r.employeeCell.rawText),names);
  assert.equal(rows[7].dayCells[30].day,31);
  assert.equal(rows[5].dayCells[0].rawText,'FÉRIAS');
});
test('preserva lacunas de dias sem deslocar turnos ou completar mês',()=>{
  const rows=parseDocumentAiSchedule(fixture([['MÊS','FABIO'],['01/QUI','1T'],['03/SAB','FOLGA']])).grid.rows;
  assert.deepEqual(rows[0].dayCells.map((c:any)=>c.day),[1,3]);
});
test('preserva vazio e código ilegível para conferência, sem inferir folga',()=>{
  const cells=parseDocumentAiSchedule(fixture([['MÊS','FABIO'],['01',''],['02','???']])).grid.rows[0].dayCells;
  assert.equal(cells[0].rawText,''); assert.equal(cells[0].confidence,0); assert.equal(cells[1].rawText,'???');
});
test('recusa dia repetido',()=>assert.throws(()=>parseDocumentAiSchedule(fixture([['MÊS','FABIO'],['01','1T'],['01','2T']])),/repetidos/));
test('recusa célula ausente em vez de atribuir turno ao funcionário errado',()=>assert.throws(()=>parseDocumentAiSchedule(fixture([['MÊS','FABIO','ISMAEL'],['01','1T']])),/desalinhada/));
test('recusa linha de turnos com dia ilegível',()=>assert.throws(()=>parseDocumentAiSchedule(fixture([['MÊS','FABIO'],['01','1T'],['??','2T']])),/ilegível/));
test('recusa célula mesclada na área de dados',()=>{
 const doc=fixture([['MÊS','FABIO'],['01','1T']]); (doc.pages[0].tables[0].bodyRows[0].cells[1] as any).colSpan=2;
 assert.throws(()=>parseDocumentAiSchedule(doc),/desalinhada/);
});
test('preserva confiança baixa',()=>{
 const doc=fixture([['MÊS','FABIO'],['01','1T']]); doc.pages[0].tables[0].bodyRows[0].cells[1].layout.confidence=.2;
 assert.equal(parseDocumentAiSchedule(doc).grid.rows[0].dayCells[0].confidence,.2);
});
test('não reconhece texto solto como escala',()=>assert.throws(()=>parseDocumentAiSchedule({text:'FABIO 01 1T'}),/não encontrou/));
test('configuração ausente falha antes de transmitir imagem',async()=>{
 const previous=process.env.DOCUMENT_AI_PROCESSOR_NAME; delete process.env.DOCUMENT_AI_PROCESSOR_NAME;
 try { await assert.rejects(analyzeWithDocumentAi({base64:'dummy',mimeType:'image/jpeg'},async()=>{throw Error('não deve chamar rede')}),/Configure o processador/); }
 finally { if(previous!==undefined)process.env.DOCUMENT_AI_PROCESSOR_NAME=previous; }
});
test('mês visível segue para validação e não assume ano selecionado',()=>{
 const result=parseDocumentAiSchedule(fixture([['OUTUBRO','FABIO'],['01','1T']]));
 assert.equal(result.document.month,10); assert.equal(result.document.year,null);
});
