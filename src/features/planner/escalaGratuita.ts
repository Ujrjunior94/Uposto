export type OcrWord = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };
const normal = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
export const codigoGratuito = (value: string) => {
  const code=normal(value).replace(/\s+/g,'');
  return ({'1T':'T1','T1':'T1','2T':'T2','T2':'T2','FOLGA':'FOLGA','FERIAS':'FERIAS','HORISTA':'HORISTA','ADM':'ADM'} as Record<string,string>)[code] || '';
};
const dayOf=(value:string)=>{const m=normal(value).match(/^(0?[1-9]|[12]\d|3[01])(?:[\s/.-]*(?:SEG|TER|QUA|QUI|SEX|SAB|DOM))?$/);return m?Number(m[1]):null;};
export function parseTabelaGratuita(input:string) {
  if(input.length>1_000_000)throw Error('Use uma tabela de até 1 MB.');
  const lines=input.replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>line.trim());
  if(lines.length<2)throw Error('Cole uma tabela com cabeçalho e pelo menos um dia.');
  const separator=lines[0].includes('\t')?'\t':lines[0].includes(';')?';':',';
  // Spreadsheet copy/paste preserves empty fields. Do not split on arbitrary spaces.
  const split=(line:string)=>{const out:string[]=[];let cell='',quoted=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quoted&&line[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===separator&&!quoted){out.push(cell.trim());cell='';}else cell+=c;}if(quoted)throw Error('Há aspas incompletas na tabela.');out.push(cell.trim());return out;};
  const table=lines.map(split), header=table[0];
  if(header.length<2||header.length>101||table.some(row=>row.length!==header.length))throw Error('As linhas têm quantidades diferentes de colunas. Use tabulações, vírgulas ou ponto e vírgula, preservando células vazias.');
  const employeeRows=header.slice(1).every(value=>dayOf(value)!==null);
  let rows:any[];
  if(employeeRows){
    const dates=header.slice(1).map(dayOf);
    if(new Set(dates).size!==dates.length)throw Error('Há dias repetidos no cabeçalho.');
    rows=table.slice(1).map((row,i)=>({rowIndex:i,employeeCell:{rawText:row[0],confidence:.7},dayCells:row.slice(1).map((rawText,j)=>({day:dates[j],columnIndex:j+1,rawText,confidence:rawText ? .7 : 0}))}));
  }else{
    if(header.slice(1).some(name=>!name||codigoGratuito(name)))throw Error('Confira os nomes no cabeçalho. Exemplo: Dia;Fábio;Ismael');
    const dates=table.slice(1).map(row=>dayOf(row[0]));
    if(dates.some(day=>day===null)||new Set(dates).size!==dates.length)throw Error('Há dias ilegíveis ou repetidos na primeira coluna.');
    rows=header.slice(1).map((name,i)=>({rowIndex:i,employeeCell:{rawText:name,confidence:.7},dayCells:table.slice(1).map((row,j)=>({day:dates[j],columnIndex:j+1,rawText:row[i+1],confidence:row[i+1] ? .7 : 0}))}));
  }
  if(rows.some(row=>!row.employeeCell.rawText)||new Set(rows.map(row=>normal(row.employeeCell.rawText))).size!==rows.length)throw Error('Há nomes vazios ou repetidos.');
  if(rows.length>100)throw Error('Importe até 100 funcionários por vez.');
  return {grid:{rows},document:{month:null,year:null},motorUtilizado:'Tabela gratuita'};
}

/** Only explicit date anchors and matching employee headers; no guessed row indices. */
export function parseOcrGratuito(words:OcrWord[], names:string[], totalDays:number) {
  const clean=words.filter(word=>word.text.trim()&&Number.isFinite(word.bbox.x0)&&Number.isFinite(word.bbox.y0));
  const cx=(w:OcrWord)=>(w.bbox.x0+w.bbox.x1)/2, cy=(w:OcrWord)=>(w.bbox.y0+w.bbox.y1)/2;
  const header=names.map(name=>{
    const token=normal(name).split(/\s+/)[0];
    const matches=clean.filter(word=>normal(word.text)===token);
    if(matches.length!==1)throw Error(`Não consegui localizar com segurança o nome ${name}. Use uma foto mais nítida ou a opção de tabela.`);
    return {name,word:matches[0]};
  }).sort((a,b)=>cx(a.word)-cx(b.word));
  if(header.length<1||new Set(header.map(h=>cx(h.word))).size!==header.length)throw Error('Não foi possível separar as colunas de funcionários.');
  const top=Math.max(...header.map(h=>h.word.bbox.y1));
  const candidates=clean.filter(word=>word.bbox.x1<header[0].word.bbox.x0 && word.bbox.y0>top && dayOf(word.text)!==null);
  const days=new Map<number,OcrWord>();
  for(const word of candidates){const day=dayOf(word.text)!;if(day>totalDays)continue;if(days.has(day))throw Error('O OCR encontrou dias repetidos. Use uma foto mais nítida ou importe uma tabela.');days.set(day,word);}
  if(days.size!==totalDays)throw Error(`O OCR local reconheceu ${days.size} de ${totalDays} dias. Para evitar deslocar turnos, use uma foto mais nítida ou cole uma tabela.`);
  const anchors=[...days].sort((a,b)=>a[0]-b[0]);
  if(anchors.some((a,i)=>i>0&&cy(a[1])<=cy(anchors[i-1][1])))throw Error('A ordem dos dias ficou ambígua. Endireite a foto e tente novamente.');
  const rowGap=Math.min(...anchors.slice(1).map((a,i)=>cy(a[1])-cy(anchors[i][1])));
  const rows=header.map((h,i)=>({rowIndex:i,employeeCell:{rawText:h.name,confidence:Math.min(.7,h.word.confidence/100)},dayCells:anchors.map(([day,anchor])=>{
    const left=i===0?header[0].word.bbox.x0-rowGap:(cx(header[i-1].word)+cx(h.word))/2;
    const right=i===header.length-1?cx(h.word)+(i?cx(h.word)-cx(header[i-1].word):rowGap*4)/2:(cx(h.word)+cx(header[i+1].word))/2;
    const cell=clean.filter(word=>cx(word)>left&&cx(word)<right&&Math.abs(cy(word)-cy(anchor))<rowGap*.4);
    const rawText=cell.map(word=>word.text).join(' ');
    return {day,columnIndex:day,rawText,confidence:codigoGratuito(rawText)?Math.min(.7,...cell.map(word=>word.confidence/100)):0};
  })}));
  return {grid:{rows},document:{month:null,year:null},motorUtilizado:'OCR local gratuito'};
}
