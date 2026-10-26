import React, { useState, useEffect } from 'react';
import { Funcionario } from '../../types';
import { processarLeituraBrutaParaValidacao, RegistroImportadoReconhecido, TURNOS_PADRAO_POSTO } from './importadorEscalaImagemService';

type RGB = [number, number, number];
type Pixels = { width: number; height: number; data: ArrayLike<number> };
export type ColorSample = { code: string; rgb: RGB };
export type GridBounds = { left: number; top: number; right: number; bottom: number };

// A modal color bucket excludes white lettering and dark table borders.
export function cellColor(pixels: Pixels, left: number, top: number, right: number, bottom: number): RGB | null {
  const buckets = new Map<string, { sum: RGB; count: number }>();
  for (let y = Math.max(0, Math.ceil(top)); y < Math.min(pixels.height, bottom); y++) {
    for (let x = Math.max(0, Math.ceil(left)); x < Math.min(pixels.width, right); x++) {
      const i = (y * pixels.width + x) * 4;
      const rgb: RGB = [pixels.data[i], pixels.data[i+1], pixels.data[i+2]];
      const max = Math.max(...rgb), min = Math.min(...rgb);
      if (pixels.data[i+3] < 200 || max < 65 || min > 225 || (max - min < 22 && (max < 100 || min > 210))) continue;
      const key = rgb.map(v => Math.floor(v / 24)).join(',');
      const entry = buckets.get(key) || { sum: [0,0,0] as RGB, count: 0 };
      entry.count++; rgb.forEach((v,j)=>entry.sum[j] += v); buckets.set(key,entry);
    }
  }
  const mode = [...buckets.values()].sort((a,b)=>b.count-a.count)[0];
  return mode ? mode.sum.map(v=>Math.round(v/mode.count)) as RGB : null;
}
const distance = (a: RGB,b: RGB) => Math.hypot(...a.map((v,i)=>v-b[i]));
export function matchColor(rgb: RGB | null, samples: ColorSample[]): string {
  if (!rgb) return '';
  const ranked = samples.map(s=>({...s,d:distance(rgb,s.rgb)})).sort((a,b)=>a.d-b.d);
  if (!ranked.length || ranked[0].d > 55 || (ranked[1] && ranked[1].d-ranked[0].d < 20)) return '';
  return ranked[0].code;
}

export function readColorGrid(pixels: Pixels, bounds: GridBounds, samples: ColorSample[], names: string[], firstDay: number, lastDay: number, employeesInColumns: boolean) {
  if (!names.length || names.some(n=>!n) || new Set(names).size!==names.length) throw new Error('Confira a ordem dos funcionários, sem nomes vazios ou repetidos.');
  if (!Number.isInteger(firstDay) || !Number.isInteger(lastDay) || firstDay < 1 || lastDay > 31 || firstDay > lastDay) throw new Error('Confira o primeiro e o último dia visíveis.');
  if (!Object.values(bounds).every(Number.isFinite) || bounds.left < 0 || bounds.top < 0 || bounds.right > 1 || bounds.bottom > 1 || bounds.right <= bounds.left || bounds.bottom <= bounds.top) throw new Error('Marque os dois cantos da área de células, sem incluir nomes ou cabeçalhos.');
  if (!samples.length) throw new Error('Indique ao menos uma cor da legenda.');
  const days = lastDay-firstDay+1;
  const columns = employeesInColumns ? names.length : days;
  const rows = employeesInColumns ? days : names.length;
  const width=(bounds.right-bounds.left)*pixels.width/columns;
  const height=(bounds.bottom-bounds.top)*pixels.height/rows;
  if (width < 5 || height < 5) throw new Error('A tabela está pequena demais. Use a imagem original ou aproxime o recorte.');
  return { grid: { headers: ['Funcionário', ...Array.from({length:days},(_,d)=>String(firstDay+d))], rows: names.map((name,employee)=>({
    rowIndex:employee, employeeCell:{rawText:name,confidence:1}, dayCells:Array.from({length:days},(_,d)=>{
      const x=employeesInColumns?employee:d, y=employeesInColumns?d:employee;
      const left=bounds.left*pixels.width+x*width, top=bounds.top*pixels.height+y*height;
      const color=cellColor(pixels,left+width*.15,top+height*.15,left+width*.85,top+height*.85);
      const code=matchColor(color,samples);
      return {day:firstDay+d,columnIndex:d+1,rawText:code,confidence:code ? 0.65 : 0};
    })
  })) }};
}

const LEGEND = [{code:'T1',label:'Turno 1'},{code:'T2',label:'Turno 2'},{code:'FOLGA',label:'Folga'},{code:'FERIAS',label:'Férias'},{code:'HORISTA',label:'Horista'},{code:'ADM',label:'Administrativo'}];
interface Props { image: string; employees: Funcionario[]; month: number; year: number; onResult: (records: RegistroImportadoReconhecido[]) => void }
export function LeituraEscalaCores({image,employees,month,year,onResult}: Props) {
  const [bounds,setBounds]=useState<GridBounds>({left:0,top:0,right:1,bottom:1});
  const [marked,setMarked]=useState<string[]>([]);
  const [mode,setMode]=useState('start');
  const [samples,setSamples]=useState<ColorSample[]>([]);
  const [names,setNames]=useState<string[]>(['']);
  const [columns,setColumns]=useState(true);
  const [first,setFirst]=useState(1), [last,setLast]=useState(new Date(year,month,0).getDate());
  const [confirmed,setConfirmed]=useState(false), [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{setBounds({left:0,top:0,right:1,bottom:1});setMarked([]);setSamples([]);setConfirmed(false);setError('');setMode('start')},[image]);
  async function pixels() {
    const img=new Image(); img.src=image; await img.decode();
    const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
    const ctx=canvas.getContext('2d',{willReadFrequently:true}); if(!ctx)throw new Error('Seu navegador não conseguiu abrir a imagem.');
    ctx.drawImage(img,0,0);return ctx.getImageData(0,0,canvas.width,canvas.height);
  }
  async function touch(e: React.MouseEvent<HTMLButtonElement>) {
    const box=e.currentTarget.getBoundingClientRect(), x=(e.clientX-box.left)/box.width, y=(e.clientY-box.top)/box.height;
    setConfirmed(false);setError('');
    if(mode==='start'||mode==='end') {
      setBounds(b=>mode==='start'?{...b,left:x,top:y}:{...b,right:x,bottom:y});setMarked(m=>[...new Set([...m,mode])]);
      if(mode==='start')setMode('end');return;
    }
    try {const data=await pixels();const rgb=cellColor(data,x*data.width-data.width*.009,y*data.height-data.height*.003,x*data.width+data.width*.009,y*data.height+data.height*.003);
      if(!rgb)throw new Error('Toque no fundo colorido de uma célula, longe da letra e da borda.');
      setSamples(old=>[...old.filter(s=>s.code!==mode),{code:mode,rgb}]);
    } catch(e:any){setError(e.message)}
  }
  async function read() {
    setBusy(true);setError('');
    try {if(marked.length!==2||!confirmed)throw new Error('Confira os dois cantos e confirme a grade.');
      const maxDay=new Date(year,month,0).getDate();if(last>maxDay)throw new Error('O último dia não existe no mês selecionado.');
      const raw=readColorGrid(await pixels(),bounds,samples,names,first,last,columns);
      onResult(processarLeituraBrutaParaValidacao(raw,employees,TURNOS_PADRAO_POSTO,month,year).records);
    } catch(e:any){setError(e.message)}finally{setBusy(false)}
  }
  const validRect=marked.length===2&&bounds.right>bounds.left&&bounds.bottom>bounds.top;
  return <section className="space-y-5 rounded-2xl border border-blue-200 bg-white p-4 text-left">
    <div><h3 className="font-bold text-slate-900">Leitura pelas cores · sem chave de IA</h3><p className="mt-2 text-sm leading-6 text-slate-600">Para tabelas retas com células do mesmo tamanho. A foto é processada neste aparelho. Cores iguais para turnos diferentes precisam de correção manual.</p></div>
    <fieldset className="space-y-3"><legend className="text-sm font-bold">1. Configure a grade que está na foto</legend>
      <label className="block text-xs font-semibold">Organização<select className="field-control mt-1" value={columns?'columns':'rows'} onChange={e=>{setColumns(e.target.value==='columns');setConfirmed(false)}}><option value="columns">Nomes no alto, dias na lateral</option><option value="rows">Nomes na lateral, dias no alto</option></select></label>
      <div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold">Primeiro dia<input type="number" min={1} max={31} value={first} onChange={e=>{setFirst(Number(e.target.value));setConfirmed(false)}} className="field-control mt-1" /></label><label className="text-xs font-semibold">Último dia<input type="number" min={first} max={31} value={last} onChange={e=>{setLast(Number(e.target.value));setConfirmed(false)}} className="field-control mt-1" /></label></div>
      <p className="text-xs text-slate-500">Selecione os nomes na ordem da foto, incluindo auxiliares. Os dias devem ser consecutivos, sem linhas omitidas.</p>
      {names.map((name,i)=><div key={i} className="flex gap-2"><label className="flex-1 text-xs">{columns?'Coluna':'Linha'} {i+1}<select className="field-control mt-1" value={name} onChange={e=>{setNames(old=>old.map((n,j)=>j===i?e.target.value:n));setConfirmed(false)}}><option value="">Escolha o funcionário</option>{employees.map(f=><option key={f.id} value={f.nome} disabled={names.includes(f.nome)&&name!==f.nome}>{f.nome}</option>)}</select></label><button type="button" aria-label={`Remover funcionário ${i+1}`} className="action-secondary mt-4" onClick={()=>{setNames(old=>old.filter((_,j)=>j!==i));setConfirmed(false)}}>×</button></div>)}
      <button type="button" className="action-secondary" onClick={()=>{setNames(old=>[...old,'']);setConfirmed(false)}}>Adicionar funcionário à grade</button>
    </fieldset>
    <div className="space-y-3"><h4 className="text-sm font-bold">2. Marque só a área das células coloridas</h4><p className="text-xs leading-5 text-slate-600">Marque o canto superior esquerdo da primeira célula e o canto inferior direito da última. Exclua cabeçalhos, nomes, datas e legenda. Você pode ampliar a tela para tocar com precisão.</p><div className="flex flex-wrap gap-2">{[{id:'start',label:'Marcar início'},{id:'end',label:'Marcar fim'}].map(b=><button type="button" aria-pressed={mode===b.id} key={b.id} className={mode===b.id?'action-primary':'action-secondary'} onClick={()=>setMode(b.id)}>{marked.includes(b.id)?'✓ ':''}{b.label}</button>)}</div>
      <p role="status" className="text-sm font-semibold text-blue-700">{mode==='start'?'Toque no canto inicial':mode==='end'?'Toque no canto final':`Toque em uma célula de ${LEGEND.find(l=>l.code===mode)?.label}`}</p>
      <button type="button" aria-label="Foto para marcar a grade ou colher uma cor" onClick={touch} className="relative block w-full overflow-hidden rounded-lg border border-slate-200"><img src={image} alt="Escala para calibrar a leitura pelas cores" className="block h-auto w-full" />{validRect&&<span aria-hidden="true" className="pointer-events-none absolute border-2 border-blue-600" style={{left:`${bounds.left*100}%`,top:`${bounds.top*100}%`,width:`${(bounds.right-bounds.left)*100}%`,height:`${(bounds.bottom-bounds.top)*100}%`,backgroundImage:`linear-gradient(to right,#2563eb55 1px,transparent 1px),linear-gradient(to bottom,#2563eb55 1px,transparent 1px)`,backgroundSize:`${100/(columns?names.length:last-first+1)}% ${100/(columns?last-first+1:names.length)}%`}} />}</button>
      {validRect&&<div className="grid grid-cols-2 gap-2">{(['left','top','right','bottom'] as const).map((key,i)=><label key={key} className="text-xs">{['Esquerda','Topo','Direita','Base'][i]} (%)<input type="number" min={0} max={100} step={.1} className="field-control" value={Number((bounds[key]*100).toFixed(1))} onChange={e=>{setBounds(b=>({...b,[key]:Number(e.target.value)/100}));setConfirmed(false)}} /></label>)}</div>}
    </div>
    <div><h4 className="mb-2 text-sm font-bold">3. Indique as cores usadas nesta foto</h4><p className="mb-3 text-xs text-slate-600">Escolha um turno abaixo e toque no fundo de uma célula desse turno na foto. Faça isso para cada cor existente. As outras ficarão pendentes.</p><div className="grid grid-cols-2 gap-2">{LEGEND.map(l=>{const sample=samples.find(s=>s.code===l.code);return <button type="button" key={l.code} aria-pressed={mode===l.code} className={`flex min-h-11 items-center gap-2 rounded-xl border p-3 text-xs font-semibold ${mode===l.code?'border-blue-600 bg-blue-50':'border-slate-200'}`} onClick={()=>setMode(l.code)}><span className="h-5 w-5 rounded border border-slate-300" style={{background:sample?`rgb(${sample.rgb.join(',')})`:'#fff'}} />{l.label}{sample?' ✓':''}</button>})}</div></div>
    <label className="flex gap-3 rounded-xl bg-blue-50 p-3 text-sm leading-6"><input type="checkbox" className="mt-1" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} />Conferi o mês, os dias consecutivos, todos os funcionários na ordem e as divisões da grade sobre a foto.</label>
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    <button type="button" disabled={busy||!confirmed||!validRect||!samples.length} className="action-primary w-full" onClick={read}>{busy?'Analisando cores…':'Gerar prévia para conferência'}</button>
    <p className="text-xs text-slate-500">A leitura usa os horários dos turnos cadastrados (T1 06–14h, T2 14–22h, Horista 08–14h e ADM 08–17h). Ela não lê horários escritos na legenda. Confira especialmente Horista e ADM antes de importar. Todos os resultados precisam de revisão. Nenhum dado é salvo nesta etapa; não aplicamos padrões 5x2 ou 12x36.</p>
  </section>;
}
