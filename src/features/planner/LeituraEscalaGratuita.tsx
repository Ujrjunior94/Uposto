import React, { useEffect, useRef, useState } from 'react';
import { Funcionario } from '../../types';
import { processarLeituraBrutaParaValidacao, TURNOS_PADRAO_POSTO, RegistroImportadoReconhecido } from './importadorEscalaImagemService';
import { parseTabelaGratuita, parseOcrGratuito } from './escalaGratuita';

type Props={image:string; employees:Funcionario[]; month:number; year:number; onResult:(rows:RegistroImportadoReconhecido[])=>void};
export function LeituraEscalaGratuita({image,employees,month,year,onResult}:Props){
 const [mode,setMode]=useState<'photo'|'table'>('photo');const [text,setText]=useState('');
 const [status,setStatus]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const worker=useRef<any>(null);const version=useRef(0);
 useEffect(()=>{version.current++;worker.current?.terminate();worker.current=null;setBusy(false);setStatus('');setError('');},[image]);
 useEffect(()=>()=>{version.current++;worker.current?.terminate();},[]);
 function deliver(raw:any){
  const result=processarLeituraBrutaParaValidacao(raw,employees,TURNOS_PADRAO_POSTO,month,year);
  if(!result.records.length)throw Error('Nenhuma célula reconhecida. Confira o formato da tabela.');
  const originals=new Map<string,string>();
  for(const row of raw.grid?.rows||[])for(const cell of row.dayCells||[])if(cell.originalText!==undefined)originals.set(`${row.rowIndex}/${cell.day}`,cell.originalText);
  onResult(result.records.map(row=>({...row,rawShiftText:originals.get(`${row.rowIndex}/${row.day}`) ?? row.rawShiftText,conferidoManualmente:false,confidence:Math.min(.7,row.confidence)})));
 }
 async function read(){
  if(busy)return;setError('');const run=++version.current;
  if(mode==='table'){try{deliver(parseTabelaGratuita(text));}catch(e:any){setError(e.message);}return;}
  if(!image){setError('Envie a foto primeiro.');return;}
  setBusy(true);setStatus('Preparando leitor no aparelho…');
  try{
   const {createWorker,OEM,PSM}=await import('tesseract.js');
   const w=await createWorker('eng',OEM.LSTM_ONLY,{workerPath:'/ocr/worker.min.js',corePath:'/ocr',langPath:'/ocr',logger:message=>{if(version.current===run)setStatus(`${message.status==='recognizing text'?'Reconhecendo texto':'Preparando leitor'} · ${Math.round(message.progress*100)}%`);}});
   if(version.current!==run){await w.terminate();return;}worker.current=w;
   await w.setParameters({tessedit_pageseg_mode:PSM.SINGLE_BLOCK,preserve_interword_spaces:'1'});
   const img=new Image();img.src=image;await img.decode();
   const scale=Math.min(2,2600/Math.max(img.width,img.height));const canvas=document.createElement('canvas');canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);
   const ctx=canvas.getContext('2d');if(!ctx)throw Error('O navegador não conseguiu preparar a foto.');ctx.drawImage(img,0,0,canvas.width,canvas.height);
   const result=await w.recognize(canvas,{}, {blocks:true});
   if(version.current!==run)return;
   const words=(result.data.blocks||[]).flatMap(block=>block.paragraphs.flatMap(p=>p.lines.flatMap(line=>line.words)));
   deliver(parseOcrGratuito(words,employees.map(e=>e.nome),new Date(year,month,0).getDate()));
  }catch(e:any){if(version.current===run)setError(e.message?.includes('local')||e.message?.includes('nome')||e.message?.includes('dias')||e.message?.includes('foto')?e.message:'Não foi possível concluir a leitura local. Tente novamente ou use a opção de tabela.');}
  finally{const w=worker.current;if(version.current===run){worker.current=null;setBusy(false);setStatus('');await w?.terminate();}}
 }
 return <section className="space-y-3 rounded-2xl border border-blue-200 bg-blue-50 p-4">
  <h3 className="font-semibold text-slate-900">Importação gratuita</h3>
  <p className="text-sm text-slate-600">Sem chave e sem cobrança por leitura. A foto é processada neste aparelho. O primeiro uso baixa os arquivos do leitor e pode demorar.</p>
  <div className="grid grid-cols-2 gap-2"><button type="button" disabled={busy} className={mode==='photo'?'action-primary':'action-secondary'} aria-pressed={mode==='photo'} onClick={()=>{setMode('photo');setError('')}}>Foto no aparelho</button><button type="button" disabled={busy} className={mode==='table'?'action-primary':'action-secondary'} aria-pressed={mode==='table'} onClick={()=>{setMode('table');setError('')}}>Colar tabela / CSV</button></div>
  {mode==='photo'?<p className="text-sm text-slate-600">Use uma imagem nítida e reta com todos os nomes e dias. Este OCR local é experimental. Fotos inclinadas ou desfocadas podem exigir uma tabela. A leitura será interrompida se os nomes ou dias ficarem ambíguos.</p>:<div className="space-y-2"><p className="text-sm text-slate-600">Copie células da sua planilha ou abra um CSV. Aceita dias nas linhas ou nas colunas. Texto de OCR deve ser organizado como tabela antes de importar.</p><label className="block text-sm">Abrir CSV ou TXT<input type="file" accept=".csv,.tsv,.txt,text/plain,text/csv" className="block w-full" onChange={async event=>{const file=event.target.files?.[0];if(!file)return;if(file.size>1_000_000){setError('Use um arquivo de até 1 MB.');return;}setText(await file.text());setError('');}}/></label><label className="block text-sm">Tabela da escala<textarea className="field-control min-h-40 w-full font-mono text-sm" value={text} onChange={event=>setText(event.target.value)} placeholder={'Dia;Fábio;Ismael\n01;1T;2T\n02;FOLGA;1T'}/></label></div>}
  {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
  {status&&<p role="status" className="text-sm text-blue-800">{status}</p>}
  <button type="button" className="action-primary w-full" disabled={busy||(mode==='photo'?!image:!text.trim())} onClick={read}>{busy?'Lendo no aparelho…':'Gerar prévia para conferir'}</button>
  {busy&&<button type="button" className="action-secondary w-full" onClick={()=>{version.current++;worker.current?.terminate();worker.current=null;setBusy(false);setStatus('')}}>Cancelar leitura</button>}
  <p className="text-xs text-slate-500">Todas as células exigem conferência antes de salvar no Planner. Nenhum padrão de folgas é aplicado.</p>
 </section>;
}
