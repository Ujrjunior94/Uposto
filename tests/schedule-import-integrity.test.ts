import assert from 'node:assert/strict';
import test from 'node:test';
import { conferirMatrizImportacao } from '../src/features/planner/integridadeImportacaoEscala';
import { prepararImportacaoEscala } from '../src/features/planner/prepararImportacaoEscala';
import { processarLeituraBrutaParaValidacao, TURNOS_PADRAO_POSTO } from '../src/features/planner/importadorEscalaImagemService';
import type { Funcionario, Escala } from '../src/types';

const employees = ['Ana', 'Bruno', 'Carlos', 'Dora', 'Auxiliar Um', 'Auxiliar Dois', 'Auxiliar Três']
  .map((nome, i) => ({ id: `f${i}`, nome, postoId: 'posto', status: 'ATIVO' }) as Funcionario);
const full = () => processarLeituraBrutaParaValidacao({grid:{rows:employees.map((employee, i) => ({
  rowIndex:i, employeeCell:{rawText:employee.nome,confidence:1},
  dayCells:Array.from({length:31}, (_,i) => ({ day:i+1,columnIndex:i+1,rawText:'T2',confidence:1 })),
}))}}, employees, TURNOS_PADRAO_POSTO, 10, 2026).records;
const scope = {funcionarioIds:employees.map(employee => employee.id), primeiroDia:1, ultimoDia:31};

test('full 31-day matrix includes all three auxiliaries and preserves T2 hours', () => {
  const records=full();
  assert.equal(conferirMatrizImportacao(records,scope,31).completa,true);
  const plan=prepararImportacaoEscala(records,employees,[],'posto','2026-10');
  assert.equal(plan.updates.length,217);
  assert.ok(plan.updates.every(row=>row.horarioInicio==='14:00' && row.horarioFim==='22:00'));
});

test('a clean rectangle containing only the first two days cannot be saved as a month', () => {
  const records=full().filter(record=>record.day<=2);
  const report=conferirMatrizImportacao(records,scope,31);
  assert.equal(report.esperados,217);
  assert.equal(report.recebidos,14);
  assert.equal(report.faltantes.length,203);
  assert.equal(report.completa,false);
  assert.throws(()=>prepararImportacaoEscala(records,employees,[],'posto','2026-10'),/incompleta/);
});

test('an entirely missing auxiliary and a deleted last-day cell remain missing', () => {
  const records=full().filter(record=>record.employeeId!=='f6' && !(record.employeeId==='f5' && record.day===31));
  const report=conferirMatrizImportacao(records,scope,31);
  assert.equal(report.faltantes.length,32);
  assert.ok(report.faltantes.some(cell=>cell.funcionarioId==='f6' && cell.dia===31));
  assert.throws(()=>prepararImportacaoEscala(records,employees,[],'posto','2026-10'),/incompleta/);
});

test('a duplicate cannot replace a missing cell even when the total count matches', () => {
  const records=full();records[216]={...records[215],id:'duplicate'};
  const report=conferirMatrizImportacao(records,scope,31);
  assert.equal(records.length,217);
  assert.equal(report.faltantes.length,1);
  assert.equal(report.duplicadas,1);
  assert.throws(()=>prepararImportacaoEscala(records,employees,[],'posto','2026-10'),/incompleta/);
});

test('a partial document requires an explicit independent scope and still rejects a hole', () => {
  const partial={funcionarioIds:['f0'],primeiroDia:15,ultimoDia:16};
  const records=full().filter(record=>record.employeeId==='f0' && [15,16].includes(record.day));
  assert.equal(prepararImportacaoEscala(records,employees,[],'posto','2026-10',undefined,partial).updates.length,2);
  assert.throws(()=>prepararImportacaoEscala(records.slice(0,1),employees,[],'posto','2026-10',undefined,partial),/incompleta/);
  assert.equal(conferirMatrizImportacao([...records,full()[0]],partial,31).foraDoEscopo,1);
});

test('invalid or repeated scope entries and non-calendar bounds never permit saving', () => {
  for(const invalid of [
    {...scope,funcionarioIds:[]}, {...scope,funcionarioIds:['f0','f0']},
    {...scope,primeiroDia:0}, {...scope,ultimoDia:32}, {...scope,primeiroDia:20,ultimoDia:19},
  ]) assert.equal(conferirMatrizImportacao(full(),invalid,31).completa,false);
  assert.equal(conferirMatrizImportacao(full(),scope,30).escopoValido,false);
});

test('the write boundary recalculates pending values and cannot trust a stale confirmation flag', () => {
  const records=full();records[0]={...records[0],status:'CONFIRMADO',shiftId:'unknown'};
  assert.throws(()=>prepararImportacaoEscala(records,employees,[],'posto','2026-10'),/pendente/);
  const original=full();original[0]={...original[0],horarioInicio:'99:99'};
  assert.equal(prepararImportacaoEscala(original,employees,[],'posto','2026-10').updates[0].horarioInicio,'14:00');
});

test('planning October preserves July IDs and never reuses records from a different station', () => {
  const existing=[
    {id:'july',postoId:'posto',funcionarioId:'f0',data:'2026-07-01'},
    {id:'other-station',postoId:'other',funcionarioId:'f0',data:'2026-10-01'},
    {id:'october-existing',postoId:'posto',funcionarioId:'f0',data:'2026-10-02',criadoEm:'original'},
  ] as Escala[];
  const plan=prepararImportacaoEscala(full(),employees,existing,'posto','2026-10');
  assert.deepEqual(plan.replaced.map(row=>row.id),['october-existing']);
  assert.ok(!plan.updates.some(row=>['july','other-station'].includes(row.id)));
  assert.equal(plan.updates.find(row=>row.id==='october-existing')?.criadoEm,'original');
  assert.equal(existing[0].data,'2026-07-01');
});

test('a foreign or inactive employee cannot enter the declared matrix', () => {
  const foreign=employees.map(employee=>employee.id==='f6'?{...employee,postoId:'other'}:employee);
  assert.throws(()=>prepararImportacaoEscala(full(),foreign,[],'posto','2026-10',undefined,scope),/funcionários/);
  const inactive=employees.map(employee=>employee.id==='f6'?{...employee,status:'INATIVO'} as Funcionario:employee);
  assert.throws(()=>prepararImportacaoEscala(full(),inactive,[],'posto','2026-10',undefined,scope),/funcionários/);
});

test('a matrix beyond one atomic repository batch is blocked before producing a write plan', () => {
  const people=Array.from({length:13},(_,i)=>({...employees[0],id:'large'+i,nome:'Pessoa '+i}));
  const records=people.flatMap(person=>full().slice(0,31).map(record=>({...record,employeeId:person.id,employeeName:person.nome,rawEmployeeText:person.nome,id:person.id+':'+record.day})));
  const manifest={funcionarioIds:people.map(person=>person.id),primeiroDia:1,ultimoDia:31};
  assert.equal(conferirMatrizImportacao(records,manifest,31).limiteExcedido,true);
  assert.equal(conferirMatrizImportacao(records,manifest,31).completa,false);
  assert.throws(()=>prepararImportacaoEscala(records,people,[],'posto','2026-10'),/400 células/);
});
