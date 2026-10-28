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

type OcrGridOptions = { employeesInColumns?: boolean; firstDay?: number; lastDay?: number };

/** Match complete names when first names repeat; a unique first name remains an explicit anchor. */
function localizarNome(words: OcrWord[], name: string, names: string[]): OcrWord {
  const target = normal(name);
  const first = target.split(/\s+/)[0];
  const cy = (w: OcrWord) => (w.bbox.y0 + w.bbox.y1) / 2;
  const exact = words.filter(w => normal(w.text) === target);
  if (target.includes(' ')) {
    for (const start of words.filter(w => normal(w.text) === first)) {
      const line = words.filter(w => w.bbox.x0 >= start.bbox.x0 &&
        Math.abs(cy(w) - cy(start)) < Math.max(w.bbox.y1-w.bbox.y0, start.bbox.y1-start.bbox.y0) / 2)
        .sort((a,b) => a.bbox.x0-b.bbox.x0);
      const tokens: OcrWord[] = [];
      for (const word of line) {
        const previous = tokens[tokens.length-1];
        if (previous && word.bbox.x0-previous.bbox.x1 > Math.max(word.bbox.y1-word.bbox.y0, 10)*2) break;
        tokens.push(word);
        const text = tokens.map(w => w.text).join(' ');
        if (normal(text) === target) {
          exact.push({ text, confidence: Math.min(...tokens.map(w => w.confidence)), bbox: {
            x0: start.bbox.x0, y0: Math.min(...tokens.map(w => w.bbox.y0)),
            x1: word.bbox.x1, y1: Math.max(...tokens.map(w => w.bbox.y1)),
          } });
          break;
        }
        if (!target.startsWith(normal(text)+' ')) break;
      }
    }
  }
  if (exact.length === 1) return exact[0];
  if (!exact.length && names.filter(n => normal(n).split(/\s+/)[0] === first).length === 1) {
    const matches = words.filter(w => normal(w.text) === first);
    if (matches.length === 1) return matches[0];
  }
  throw Error(`Não consegui localizar com segurança o nome ${name}. Confira a orientação, a equipe e a nitidez da foto ou use a opção de tabela.`);
}

/** Read only explicit name/day anchors in the orientation declared by the user. */
export function parseOcrGratuito(words: OcrWord[], names: string[], totalDays: number, options: OcrGridOptions = {}) {
  const { employeesInColumns = true, firstDay = 1, lastDay = totalDays } = options;
  if (!names.length || names.length > 100 || new Set(names.map(normal)).size !== names.length ||
    !Number.isInteger(firstDay) || !Number.isInteger(lastDay) || firstDay < 1 || lastDay > totalDays || firstDay > lastDay)
    throw Error('Confira a equipe e o primeiro e último dia do documento.');
  const clean = words.filter(word => typeof word.text === 'string' && word.text.trim() &&
    Object.values(word.bbox).every(Number.isFinite) && word.bbox.x1 > word.bbox.x0 && word.bbox.y1 > word.bbox.y0);
  const cx = (w: OcrWord) => (w.bbox.x0+w.bbox.x1)/2;
  const cy = (w: OcrWord) => (w.bbox.y0+w.bbox.y1)/2;
  const employeePosition = employeesInColumns ? cx : cy;
  const dayPosition = employeesInColumns ? cy : cx;
  const header = names.map(name => ({ name, word: localizarNome(clean, name, names) }))
    .sort((a,b) => employeePosition(a.word)-employeePosition(b.word));
  if (new Set(header.map(h => employeePosition(h.word))).size !== header.length)
    throw Error('Não foi possível separar os funcionários. Confira a orientação da tabela.');
  const edge = Math.max(...header.map(h => employeesInColumns ? h.word.bbox.y1 : h.word.bbox.x1));
  const candidates = clean.filter(word => (employeesInColumns
    ? word.bbox.x1 < header[0].word.bbox.x0 && word.bbox.y0 > edge
    : word.bbox.y1 < header[0].word.bbox.y0 && word.bbox.x0 > edge) && dayOf(word.text) !== null);
  const days = new Map<number,OcrWord>();
  for (const word of candidates) {
    const day = dayOf(word.text)!;
    if (day < firstDay || day > lastDay) continue;
    if (days.has(day)) throw Error('O OCR encontrou dias repetidos. Use uma foto mais nítida ou importe uma tabela.');
    days.set(day,word);
  }
  const expected = lastDay-firstDay+1;
  if (days.size !== expected)
    throw Error(`O OCR local reconheceu ${days.size} de ${expected} dias. Para evitar deslocar turnos, use uma foto mais nítida ou cole uma tabela.`);
  const anchors = [...days].sort((a,b) => a[0]-b[0]);
  if (anchors.some((a,i) => i>0 && dayPosition(a[1]) <= dayPosition(anchors[i-1][1])))
    throw Error('A ordem dos dias ficou ambígua. Endireite a foto e tente novamente.');
  const gaps = anchors.slice(1).map((a,i) => dayPosition(a[1])-dayPosition(anchors[i][1]));
  const dayGap = gaps.length ? Math.min(...gaps) : Math.max(20, employeesInColumns
    ? (anchors[0][1].bbox.y1-anchors[0][1].bbox.y0)*2
    : (anchors[0][1].bbox.x1-anchors[0][1].bbox.x0)*2);
  const rows = header.map((h,i) => {
    const position = employeePosition(h.word);
    const previous = header[i-1], next = header[i+1];
    const size = employeesInColumns ? h.word.bbox.x1-h.word.bbox.x0 : h.word.bbox.y1-h.word.bbox.y0;
    const start = previous ? (employeePosition(previous.word)+position)/2
      : position-(next ? employeePosition(next.word)-position : Math.max(size,dayGap*2))/2;
    const end = next ? (position+employeePosition(next.word))/2
      : position+(previous ? position-employeePosition(previous.word) : Math.max(size,dayGap*2))/2;
    return { rowIndex:i, employeeCell:{ rawText:h.name, confidence:Math.min(.7,h.word.confidence/100) },
      dayCells:anchors.map(([day,anchor]) => {
        const cell = clean.filter(word => employeePosition(word)>start && employeePosition(word)<end &&
          Math.abs(dayPosition(word)-dayPosition(anchor)) < dayGap*.4)
          .sort((a,b) => cy(a)-cy(b) || cx(a)-cx(b));
        const originalText = cell.map(word => word.text).join(' ');
        const raw = normal(originalText).replace(/\s+/g,'');
        const suggested = /^T[IL]$/.test(raw) ? 'T1' : /^[IL]T$/.test(raw) ? '1T' : originalText;
        return { day, columnIndex:day, rawText:suggested, originalText,
          confidence:codigoGratuito(suggested) && cell.length
            ? Math.min(suggested !== originalText ? .45 : .7, ...cell.map(word => word.confidence/100)) : 0 };
      }),
    };
  });
  return { grid:{rows}, document:{month:null,year:null}, motorUtilizado:'OCR local gratuito' };
}
