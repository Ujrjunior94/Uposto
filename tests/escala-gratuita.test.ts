import test from 'node:test';import assert from 'node:assert/strict';
import { parseTabelaGratuita, parseOcrGratuito, codigoGratuito, OcrWord } from '../src/features/planner/escalaGratuita.ts';
import { processarLeituraBrutaParaValidacao, TURNOS_PADRAO_POSTO } from '../src/features/planner/importadorEscalaImagemService.ts';
const names=['FABIO','ISMAEL','DIEGO','JUNIOR','DAVID','ROMILSON','MOABE','UBIRAJARA'];
test('CSV preserva 8 pessoas, auxiliares e 31 dias sem completar padrões',()=>{
 const text=['Dia;'+names.join(';'),...Array.from({length:31},(_,i)=>[i+1,...names.map((_,j)=>j===5?'FÉRIAS':j%2?'1T':'2T')].join(';'))].join('\n');
 const rows=parseTabelaGratuita(text).grid.rows; assert.equal(rows.length,8);assert.equal(rows.flatMap(r=>r.dayCells).length,248);assert.equal(rows[7].dayCells[30].day,31);assert.equal(rows[5].dayCells[0].rawText,'FÉRIAS');
 const employees=names.map((nome,i)=>({id:String(i),nome,status:'ATIVO'})) as any;
 const validated=processarLeituraBrutaParaValidacao(parseTabelaGratuita(text),employees,TURNOS_PADRAO_POSTO,10,2026);
 assert.equal(validated.records.length,248);assert.ok(validated.records.every(r=>r.status!=='CONFIRMADO'));
});
test('planilha transposta preserva posições e vazio na última coluna da última linha',()=>{
 const rows=parseTabelaGratuita('Funcionário\t01\t03\nFABIO\t1T\t').grid.rows;
 assert.deepEqual(rows[0].dayCells.map((c:any)=>c.day),[1,3]);assert.equal(rows[0].dayCells[1].rawText,'');assert.equal(rows[0].dayCells[1].confidence,0);
});
test('CSV com nomes entre aspas e separador interno',()=>assert.equal(parseTabelaGratuita('Dia,"FABIO, JUNIOR"\n01,1T').grid.rows[0].employeeCell.rawText,'FABIO, JUNIOR'));
test('colunas perdidas não deslocam turnos',()=>assert.throws(()=>parseTabelaGratuita('Dia;FABIO;ISMAEL\n01;1T'),/diferentes/));
test('dias repetidos são bloqueados nas duas orientações',()=>{assert.throws(()=>parseTabelaGratuita('Dia;FABIO\n01;1T\n01;2T'),/repetidos/);assert.throws(()=>parseTabelaGratuita('Nome;01;01\nFABIO;1T;2T'),/repetidos/)});
test('nomes vazios ou duplicados não passam',()=>assert.throws(()=>parseTabelaGratuita('Dia;FABIO;FABIO\n01;1T;2T'),/repetidos/));
test('17 não é inventado como turno 1',()=>{assert.equal(codigoGratuito('17'),'');assert.equal(codigoGratuito('1T'),'T1');assert.equal(codigoGratuito('Férias'),'FERIAS')});
const w=(text:string,x:number,y:number):OcrWord=>({text,confidence:95,bbox:{x0:x,y0:y,x1:x+20,y1:y+10}});
test('OCR exige todos os dias e nunca estima por posição',()=>assert.throws(()=>parseOcrGratuito([w('FABIO',100,0),w('01',0,30),w('1T',100,30)],['FABIO'],31),/1 de 31/));
test('OCR usa texto do dia e conserva células vazias',()=>{
 const words=[w('FABIO',100,0),w('ISMAEL',200,0),w('01',0,30),w('02',0,60),w('1T',100,30),w('2T',200,30),w('FOLGA',100,60)];
 const rows=parseOcrGratuito(words,['FABIO','ISMAEL'],2).grid.rows;
 assert.equal(rows[0].dayCells[0].rawText,'1T');assert.equal(rows[1].dayCells[1].rawText,'');assert.equal(rows[1].dayCells[1].confidence,0);
});
test('OCR recusa auxiliar cujo nome não foi localizado',()=>assert.throws(()=>parseOcrGratuito([w('FABIO',100,0)],['FABIO','UBIRAJARA'],31),/UBIRAJARA/));
test('OCR recusa nomes ambíguos e dias duplicados',()=>{
 assert.throws(()=>parseOcrGratuito([w('FABIO',100,0),w('FABIO',200,0)],['FABIO'],2),/nome/);
 assert.throws(()=>parseOcrGratuito([w('FABIO',100,0),w('01',0,30),w('01',0,60)],['FABIO'],2),/repetidos/);
});
