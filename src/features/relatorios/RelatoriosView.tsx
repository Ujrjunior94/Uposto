import React, { useState, useMemo } from 'react';
import {
  Funcionario,
  Escala,
  FechamentoCaixa,
  OcorrenciaCaixa,
  Tanque,
  Bico,
  Afericao,
  RegistroDensidade,
  Conformidade,
  AuditLog,
} from '../../types';
import {
  FileText,
  Printer,
  Download,
  Search,
  Trash2,
  FileDown,
  DollarSign,
  Gauge,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  FlaskConical,
  ShieldCheck,
  Layers,
  FileCheck,
  Receipt,
  ChevronLeft,
  Fuel,
  Filter,
  ChevronDown,
  ChevronUp,
  Clock,
  RotateCcw,
  XCircle,
  Smartphone,
  Share2,
  Sparkles,
  Calendar,
  Users,
} from 'lucide-react';
import { formatarMoeda } from '../../utils/calculations';
import { PRECOS_PADRAO_COMBUSTIVEL, calcularPrecoEfetivoBico } from '../../utils/pricing';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  gerarRelatorioMobilePDF,
  formatarDataBR,
  formatarLitros,
  exportarRelatorioCombustivel5ColunasPDF,
  ItemRelatorioCombustivel5Colunas,
} from '../../utils/pdfGenerator';


/** Keeps the same report data readable as labeled cards on narrow screens. */
function ReportTable({ children, className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  type Element = React.ReactElement<{ children?: React.ReactNode; colSpan?: number; 'data-label'?: string }>;
  const elements = (nodes: React.ReactNode): Element[] =>
    React.Children.toArray(nodes).flatMap((node) => {
      if (!React.isValidElement(node)) return [];
      const element = node as Element;
      return element.type === React.Fragment ? elements(element.props.children) : [element];
    });
  const text = (node: React.ReactNode): string => React.Children.toArray(node).map((item): string =>
    React.isValidElement(item) ? text((item as Element).props.children) : String(item)
  ).join(' ').trim();
  const sections = elements(children);
  const header = sections.find((section) => section.type === 'thead');
  const headerRow = header && elements(header.props.children).find((row) => row.type === 'tr');
  const labels = headerRow ? elements(headerRow.props.children).map((cell) => text(cell.props.children)) : [];
  const labeledSections = sections.map((section) => {
    if (section.type !== 'tbody' && section.type !== 'tfoot') return section;
    return React.cloneElement(section, {}, elements(section.props.children).map((row) => {
      if (row.type !== 'tr') return row;
      let column = 0;
      return React.cloneElement(row, {}, elements(row.props.children).map((cell) => {
        const label = labels[column] || '';
        column += cell.props.colSpan || 1;
        return React.cloneElement(cell, { 'data-label': cell.props.colSpan && cell.props.colSpan > 1 ? '' : label });
      }));
    }));
  });
  return <table {...props} className={`report-table ${className || ''}`}>{labeledSections}</table>;
}

const reportMobileStyles = `
@media screen and (max-width: 639px) {
  .report-table { display: block; width: 100%; min-width: 0; }
  .report-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .report-table tbody, .report-table tfoot { display: block; width: 100%; }
  .report-table tr { display: block; margin: 8px; border: 1px solid #e2e8f0; border-radius: 12px; padding: 6px 10px; background: white; }
  .report-table td { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: 10px; align-items: start; padding: 9px 0; white-space: normal; overflow-wrap: anywhere; border-bottom: 1px solid #f1f5f9; font-size: 12px; }
  .report-table td::before { content: attr(data-label); font-family: sans-serif; font-weight: 600; color: #64748b; text-align: left; }
  .report-table td[data-label=""] { display: block; }
  .report-table td[data-label=""]::before { display: none; }
  .report-table td:last-child { border-bottom: 0; }
  .report-table td > * { min-width: 0; }
  .reports-view { min-width: 0; overflow-wrap: anywhere; }
}
`;

interface RelatoriosProps {
  funcionarios: Funcionario[];
  escalas: Escala[];
  fechamentos: FechamentoCaixa[];
  ocorrencias: OcorrenciaCaixa[];
  tanques: Tanque[];
  bicos: Bico[];
  afericoes: Afericao[];
  densidades: RegistroDensidade[];
  conformidades: Conformidade[];
  auditoria: AuditLog[];
  onLimparDemonstracao?: () => void;
}

type TipoRelatorio =
  | 'BALANCO_CONSOLIDADO'
  | 'COMBUSTIVEL_5COL'
  | 'AGRUPADO_COMBUSTIVEL'
  | 'FECHAMENTOS'
  | 'AFERICOES'
  | 'ANALISES'
  | 'DENSIDADES'
  | 'AUDITORIA'
  | 'ESCALAS'
  | 'TANQUES'
  | 'FALTAS'
  | 'CONFORMIDADE'
  | 'FUNCIONARIOS';

export const RelatoriosView: React.FC<RelatoriosProps> = ({
  funcionarios,
  escalas,
  fechamentos,
  ocorrencias,
  tanques,
  bicos,
  afericoes,
  densidades,
  conformidades,
  auditoria,
  onLimparDemonstracao,
}) => {
  const [tipo, setTipo] = useState<TipoRelatorio>('BALANCO_CONSOLIDADO');
  const [subModoEscala, setSubModoEscala] = useState<
    'DIARIO' | 'SEMANAL' | 'MENSAL' | 'FUNCIONARIO' | 'SETOR'
  >('MENSAL');
  const [filtroFuncRelatorio, setFiltroFuncRelatorio] = useState<string>('TODOS');
  const [filtroSetorRelatorio, setFiltroSetorRelatorio] = useState<string>('TODOS');
  const [filtroCombustivel, setFiltroCombustivel] = useState<string>('TODOS');
  const [combustivelAberto, setCombustivelAberto] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [dataInicio, setDataInicio] = useState(new Date().toISOString().slice(0, 7) + '-01');
  const [dataFim, setDataFim] = useState(new Date().toISOString().slice(0, 7) + '-31');
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const [modoTermico80mm, setModoTermico80mm] = useState(false);
  const [filtroSecaoTermica, setFiltroSecaoTermica] = useState<
    'TODOS' | 'CAIXA' | 'AFERICOES' | 'QUALIDADE'
  >('TODOS');
  const [tamanhoFonteTermica, setTamanhoFonteTermica] = useState<'NORMAL' | 'CONDENSADA'>('NORMAL');

  // Modo de visualização simplificada para telas mobile e leitura executiva ágil
  const [modoSimplificado, setModoSimplificado] = useState<boolean>(true);
  const [abaSimplificada, setAbaSimplificada] = useState<
    'TODOS' | 'CAIXA' | 'COMBUSTIVEL' | 'AFERICOES' | 'ESCALA'
  >('TODOS');

  // Estados exclusivos de Agrupamento e Filtragem de Aferições
  const [agrupamentoAfericoes, setAgrupamentoAfericoes] = useState<
    'COMBUSTIVEL' | 'CRONOLOGICO' | 'BICO'
  >('COMBUSTIVEL');
  const [filtroStatusAfericao, setFiltroStatusAfericao] = useState<
    'TODOS' | 'CONFORME' | 'FORA_LIMITE'
  >('TODOS');
  const [filtroBicoAfericao, setFiltroBicoAfericao] = useState<string>('TODOS');
  const [combustiveisExpandidos, setCombustiveisExpandidos] = useState<Record<string, boolean>>({});

  // Lista dinâmica e unificada de combustíveis do posto
  const listaCombustiveisDisponiveis = useMemo(() => {
    const set = new Set<string>();
    ['Gasolina Comum', 'Gasolina Aditivada', 'Etanol Hidratado', 'Diesel S10', 'Diesel S500'].forEach(
      (p) => set.add(p)
    );
    afericoes.forEach((a) => {
      if (a.produto) set.add(a.produto);
    });
    bicos.forEach((b) => {
      if (b.produto) set.add(b.produto);
    });
    tanques.forEach((t) => {
      if (t.produto) set.add(t.produto);
    });
    return Array.from(set);
  }, [afericoes, bicos, tanques]);

  // Filtros reativos por período e busca
  const fechamentosFiltrados = useMemo(() => {
    return fechamentos
      .filter((f) => {
        if (dataInicio && f.data < dataInicio) return false;
        if (dataFim && f.data > dataFim) return false;
        if (busca.trim()) {
          const q = busca.toLowerCase();
          if (
            !(f.funcionarioNome || '').toLowerCase().includes(q) &&
            !(f.turno || '').toLowerCase().includes(q) &&
            !f.data.includes(q) &&
            !(f.tipoDiferenca || '').toLowerCase().includes(q)
          ) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => b.data.localeCompare(a.data));
  }, [fechamentos, dataInicio, dataFim, busca]);

  const afericoesFiltradas = useMemo(() => {
    return afericoes
      .filter((a) => {
        if (dataInicio && a.data < dataInicio) return false;
        if (dataFim && a.data > dataFim) return false;
        if (filtroCombustivel !== 'TODOS' && a.produto !== filtroCombustivel) return false;
        if (filtroStatusAfericao === 'CONFORME' && a.resultado !== 'CONFORME') return false;
        if (filtroStatusAfericao === 'FORA_LIMITE' && a.resultado === 'CONFORME') return false;
        if (filtroBicoAfericao !== 'TODOS') {
          const num = a.bicoNumero ?? (a.bicoId ? parseInt(a.bicoId.replace(/\D/g, ''), 10) : undefined);
          if (String(num) !== filtroBicoAfericao && a.bicoId !== filtroBicoAfericao) return false;
        }
        if (busca.trim()) {
          const q = busca.toLowerCase();
          if (
            !(a.produto || '').toLowerCase().includes(q) &&
            !(a.responsavelNome || '').toLowerCase().includes(q) &&
            !String(a.bicoNumero || a.bicoId).toLowerCase().includes(q) &&
            !(a.resultado || '').toLowerCase().includes(q) &&
            !(a.bombaNome || '').toLowerCase().includes(q) &&
            !(a.lacreInmetro || '').toLowerCase().includes(q)
          ) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => b.data.localeCompare(a.data) || (b.hora || '').localeCompare(a.hora || ''));
  }, [afericoes, dataInicio, dataFim, filtroCombustivel, filtroStatusAfericao, filtroBicoAfericao, busca]);

  const escalasFiltradas = useMemo(() => {
    return escalas
      .filter((e) => {
        if (dataInicio && e.data < dataInicio) return false;
        if (dataFim && e.data > dataFim) return false;
        if (subModoEscala === 'DIARIO' && dataInicio && e.data !== dataInicio) return false;
        if (filtroFuncRelatorio !== 'TODOS' && e.funcionarioId !== filtroFuncRelatorio) return false;
        if (filtroSetorRelatorio !== 'TODOS' && (e.setor || 'Pista') !== filtroSetorRelatorio) return false;
        if (busca.trim()) {
          const q = busca.toLowerCase();
          if (
            !e.funcionarioNome.toLowerCase().includes(q) &&
            !(e.setor || '').toLowerCase().includes(q) &&
            !e.turno.toLowerCase().includes(q)
          ) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => a.data.localeCompare(b.data) || a.funcionarioNome.localeCompare(b.funcionarioNome));
  }, [escalas, dataInicio, dataFim, subModoEscala, filtroFuncRelatorio, filtroSetorRelatorio, busca]);

  const analisesFiltradas = useMemo(() => {
    return (densidades || [])
      .filter((d) => {
        if (dataInicio && d.data < dataInicio) return false;
        if (dataFim && d.data > dataFim) return false;
        if (filtroCombustivel !== 'TODOS' && d.produto !== filtroCombustivel) return false;
        if (busca.trim()) {
          const q = busca.toLowerCase();
          if (
            !(d.produto || '').toLowerCase().includes(q) &&
            !(d.responsavelId || '').toLowerCase().includes(q) &&
            !(d.resultado || (d as any).status || '').toLowerCase().includes(q) &&
            !(d.tipoTeste || '').toLowerCase().includes(q)
          ) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => b.data.localeCompare(a.data) || (b.hora || '').localeCompare(a.hora || ''));
  }, [densidades, dataInicio, dataFim, filtroCombustivel, busca]);

  const tanquesFiltrados = useMemo(() => {
    return (tanques || []).filter((t) => {
      if (filtroCombustivel !== 'TODOS' && t.produto !== filtroCombustivel) return false;
      if (busca.trim()) {
        const q = busca.toLowerCase();
        if (!t.codigo.toLowerCase().includes(q) && !(t.produto || '').toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [tanques, filtroCombustivel, busca]);

  const bicosFiltrados = useMemo(() => {
    return (bicos || []).filter((b) => {
      if (filtroCombustivel !== 'TODOS' && b.produto !== filtroCombustivel) return false;
      if (busca.trim()) {
        const q = busca.toLowerCase();
        if (
          !String(b.numero).includes(q) &&
          !b.bomba.toLowerCase().includes(q) &&
          !(b.produto || '').toLowerCase().includes(q) &&
          !(b.tanqueCodigo || '').toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [bicos, filtroCombustivel, busca]);

  const auditoriaFiltrada = useMemo(() => {
    return (auditoria || [])
      .filter((l) => {
        const itemData = l.timestamp ? new Date(l.timestamp).toISOString().slice(0, 10) : '';
        if (dataInicio && itemData && itemData < dataInicio) return false;
        if (dataFim && itemData && itemData > dataFim) return false;
        if (busca.trim()) {
          const q = busca.toLowerCase();
          if (
            !(l.usuarioNome || '').toLowerCase().includes(q) &&
            !(l.modulo || '').toLowerCase().includes(q) &&
            !(l.acao || '').toLowerCase().includes(q) &&
            !(l.entidade || '').toLowerCase().includes(q)
          ) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return timeB - timeA;
      });
  }, [auditoria, dataInicio, dataFim, busca]);

  // Helper para preço vigente do bico / combustível
  const resolverPrecoBico = (bicoId?: string, bicoNum?: number, produto?: string): number => {
    const b = bicos.find(
      (item) => (bicoId && item.id === bicoId) || (bicoNum !== undefined && item.numero === bicoNum)
    );
    if (b) {
      const res = calcularPrecoEfetivoBico(b);
      if (res.precoFinal > 0) return res.precoFinal;
    }
    const prod = produto || b?.produto || 'Gasolina Comum';
    return PRECOS_PADRAO_COMBUSTIVEL[prod] || 5.89;
  };

  // Consolidação Geral dos 4 Pilares: Fechamentos, Aferições, Análises e Auditoria
  const balancoConsolidado = useMemo(() => {
    const totalConferido = fechamentosFiltrados.reduce((acc, f) => acc + (Number(f.totalConferido) || 0), 0);
    const totalInformado = fechamentosFiltrados.reduce((acc, f) => acc + (Number(f.totalInformado) || 0), 0);
    const saldoDiferenca = fechamentosFiltrados.reduce((acc, f) => acc + (Number(f.diferenca) || 0), 0);
    const totalSobras = fechamentosFiltrados
      .filter((f) => f.diferenca > 0)
      .reduce((acc, f) => acc + Number(f.diferenca), 0);
    const totalFaltas = fechamentosFiltrados
      .filter((f) => f.diferenca < 0)
      .reduce((acc, f) => acc + Math.abs(Number(f.diferenca)), 0);

    const meiosPagamento = fechamentosFiltrados.reduce(
      (acc, f) => {
        acc.pix += Number(f.recolhimento?.pix || f.vendasPix || 0);
        acc.cartao += Number(
          f.recolhimento?.cartao || (f.vendasCartaoCredito || 0) + (f.vendasCartaoDebito || 0)
        );
        acc.deposito += Number(f.recolhimento?.deposito || f.vendasDinheiro || 0);
        acc.nota += Number(f.recolhimento?.nota || 0);
        acc.pixCnpj += Number(f.recolhimento?.pixCnpj || 0);
        acc.despesa += Number(f.recolhimento?.despesa || 0);
        acc.outros += Number(f.recolhimento?.outros || f.vendasOutros || 0);
        return acc;
      },
      { pix: 0, cartao: 0, deposito: 0, nota: 0, pixCnpj: 0, despesa: 0, outros: 0 }
    );

    // Métricas de Aferições
    const totalAfericoes = afericoesFiltradas.length;
    const afericoesConformes = afericoesFiltradas.filter((a) => a.resultado === 'CONFORME').length;
    const afericoesNaoConformes = totalAfericoes - afericoesConformes;
    const taxaConformidade =
      totalAfericoes > 0 ? ((afericoesConformes / totalAfericoes) * 100).toFixed(1) : '100.0';

    const volumeTotalNominal = afericoesFiltradas.reduce(
      (acc, a) => acc + (Number(a.volumeNominal) || 20),
      0
    );
    const volumeTotalAferido = afericoesFiltradas.reduce(
      (acc, a) => acc + (Number(a.volumeAferido) || 20),
      0
    );
    const desvioTotalMl = afericoesFiltradas.reduce(
      (acc, a) => acc + Math.round((Number(a.diferenca) || 0) * 1000),
      0
    );
    const desvioMedioMl = totalAfericoes > 0 ? Math.round(desvioTotalMl / totalAfericoes) : 0;

    // 1. Agrupamento por tipo de combustível (com Valor Total, Impacto em 1.000 L e lista de ensaios)
    const mapaPorCombustivel = new Map<
      string,
      {
        produto: string;
        bicosNumeros: Set<number>;
        qtdTestes: number;
        volumeAferidoTotal: number;
        valorTotalAfericao: number;
        desvioTotalMl: number;
        conformes: number;
        naoConformes: number;
        listaAfericoes: (Afericao & { desvioMl: number; valorTeste: number })[];
      }
    >();

    // 2. Agrupamento consolidado por bico aferido (com Informações do Bico, Valor Total e Impacto em 1.000 L)
    const mapaPorBico = new Map<
      number,
      {
        bicoNumero: number;
        bicoId: string;
        bombaNome: string;
        ladoBomba: string;
        produto: string;
        tanqueCodigo: string;
        encerranteInicial?: number;
        encerranteFinal?: number;
        lacreInmetro?: string;
        qtdTestes: number;
        volumeAferidoTotal: number;
        precoLitro: number;
        valorTotalAfericao: number;
        desvioTotalMl: number;
        conformes: number;
        naoConformes: number;
        ultimaData: string;
        listaAfericoes: (Afericao & { desvioMl: number; valorTeste: number })[];
      }
    >();

    let valorTotalAfericoesGeral = 0;

    afericoesFiltradas.forEach((a) => {
      const prod = a.produto || 'Combustível';
      const volNominal = Number(a.volumeNominal) || 20;
      const volAferido = Number(a.volumeAferido) || 20;
      const desvioMl = Math.round((Number(a.diferenca) || 0) * 1000);
      const isConforme = a.resultado === 'CONFORME';

      const bicoNum =
        a.bicoNumero ??
        (a.bicoId ? parseInt(a.bicoId.replace(/\D/g, ''), 10) : undefined) ??
        1;
      const bicoCad = bicos.find((b) => b.id === a.bicoId || b.numero === bicoNum);
      const precoLitro = resolverPrecoBico(a.bicoId, bicoNum, prod);
      const valorTeste = volNominal * precoLitro;

      valorTotalAfericoesGeral += valorTeste;

      // Atualiza mapa de combustível
      const comb = mapaPorCombustivel.get(prod) || {
        produto: prod,
        bicosNumeros: new Set<number>(),
        qtdTestes: 0,
        volumeAferidoTotal: 0,
        valorTotalAfericao: 0,
        desvioTotalMl: 0,
        conformes: 0,
        naoConformes: 0,
        listaAfericoes: [],
      };
      comb.bicosNumeros.add(bicoNum);
      comb.qtdTestes += 1;
      comb.volumeAferidoTotal += volAferido;
      comb.valorTotalAfericao += valorTeste;
      comb.desvioTotalMl += desvioMl;
      if (isConforme) comb.conformes += 1;
      else comb.naoConformes += 1;
      comb.listaAfericoes.push({
        ...a,
        desvioMl,
        valorTeste,
      });
      mapaPorCombustivel.set(prod, comb);

      // Atualiza mapa de bico
      const bicoExistente = mapaPorBico.get(bicoNum) || {
        bicoNumero: bicoNum,
        bicoId: a.bicoId || `bico-${bicoNum}`,
        bombaNome: a.bombaNome || (bicoCad ? `${bicoCad.bomba} (Lado ${bicoCad.lado})` : `Bomba 01`),
        ladoBomba: a.ladoBomba || bicoCad?.lado || 'A',
        produto: prod,
        tanqueCodigo: a.tanqueCodigo || a.tanqueId || bicoCad?.tanqueCodigo || 'TQ',
        encerranteInicial: a.encerranteInicial,
        encerranteFinal: a.encerranteFinal ?? (a as any).encerranteLeitura,
        lacreInmetro: a.lacreInmetro,
        qtdTestes: 0,
        volumeAferidoTotal: 0,
        precoLitro,
        valorTotalAfericao: 0,
        desvioTotalMl: 0,
        conformes: 0,
        naoConformes: 0,
        ultimaData: a.data,
        listaAfericoes: [],
      };
      bicoExistente.qtdTestes += 1;
      bicoExistente.volumeAferidoTotal += volAferido;
      bicoExistente.valorTotalAfericao += valorTeste;
      bicoExistente.desvioTotalMl += desvioMl;
      if (isConforme) bicoExistente.conformes += 1;
      else bicoExistente.naoConformes += 1;
      if (a.encerranteFinal) bicoExistente.encerranteFinal = a.encerranteFinal;
      if (a.lacreInmetro) bicoExistente.lacreInmetro = a.lacreInmetro;
      if (a.data >= bicoExistente.ultimaData) bicoExistente.ultimaData = a.data;
      bicoExistente.listaAfericoes.push({
        ...a,
        desvioMl,
        valorTeste,
      });
      mapaPorBico.set(bicoNum, bicoExistente);
    });

    const resumoPorCombustivel = Array.from(mapaPorCombustivel.values()).map((c) => {
      const desvioMedioMl = c.qtdTestes > 0 ? Math.round(c.desvioTotalMl / c.qtdTestes) : 0;
      // Impacto em 1.000 L de abastecimento: (desvioMedioMl * 50) / 1000 = desvioMedioMl / 20 Litros
      const impactoLitrosPor1000L = Number(((desvioMedioMl * 50) / 1000).toFixed(2));
      const precoMedioLitro =
        c.volumeAferidoTotal > 0 ? c.valorTotalAfericao / c.volumeAferidoTotal : 5.89;
      const impactoFinanceiroPor1000L = Number((impactoLitrosPor1000L * precoMedioLitro).toFixed(2));
      const taxaConformidade =
        c.qtdTestes > 0 ? ((c.conformes / c.qtdTestes) * 100).toFixed(1) : '100.0';

      return {
        produto: c.produto,
        bicosQtd: c.bicosNumeros.size,
        bicosNumeros: Array.from(c.bicosNumeros).sort((a, b) => a - b),
        qtdTestes: c.qtdTestes,
        volumeAferidoTotal: c.volumeAferidoTotal,
        precoMedioLitro,
        valorTotalAfericao: c.valorTotalAfericao,
        desvioTotalMl: c.desvioTotalMl,
        desvioMedioMl,
        impactoLitrosPor1000L,
        impactoFinanceiroPor1000L,
        conformes: c.conformes,
        naoConformes: c.naoConformes,
        taxaConformidade,
        listaAfericoes: c.listaAfericoes,
      };
    });

    const resumoPorBico = Array.from(mapaPorBico.values())
      .map((b) => {
        const desvioMedioMl = b.qtdTestes > 0 ? Math.round(b.desvioTotalMl / b.qtdTestes) : 0;
        const impactoLitrosPor1000L = Number(((desvioMedioMl * 50) / 1000).toFixed(2));
        const impactoFinanceiroPor1000L = Number((impactoLitrosPor1000L * b.precoLitro).toFixed(2));
        const statusGeral: 'CONFORME' | 'NAO_CONFORME' =
          b.naoConformes === 0 ? 'CONFORME' : 'NAO_CONFORME';
        const listaAfericoesOrdenada = [...(b.listaAfericoes || [])].sort((x, y) => {
          const dtX = `${x.data}T${x.hora || '00:00'}`;
          const dtY = `${y.data}T${y.hora || '00:00'}`;
          return dtX.localeCompare(dtY);
        });

        return {
          ...b,
          desvioMedioMl,
          impactoLitrosPor1000L,
          impactoFinanceiroPor1000L,
          statusGeral,
          listaAfericoes: listaAfericoesOrdenada,
        };
      })
      .sort((a, b) => a.bicoNumero - b.bicoNumero);

    const impactoMedioGeralLitros1000L =
      totalAfericoes > 0 ? Number(((desvioMedioMl * 50) / 1000).toFixed(2)) : 0;
    const precoMedioGeral =
      volumeTotalAferido > 0 ? valorTotalAfericoesGeral / volumeTotalAferido : 5.89;
    const impactoMedioGeralFinanceiro1000L = Number(
      (impactoMedioGeralLitros1000L * precoMedioGeral).toFixed(2)
    );

    // Métricas de Análises ANP
    const totalAnalises = analisesFiltradas.length;
    const analisesConformes = analisesFiltradas.filter(
      (d) => (d.resultado || (d as any).status) === 'CONFORME'
    ).length;
    const analisesNaoConformes = totalAnalises - analisesConformes;
    const taxaConformidadeAnalises =
      totalAnalises > 0 ? ((analisesConformes / totalAnalises) * 100).toFixed(1) : '100.0';

    // Métricas de Auditoria
    const totalAuditoria = auditoriaFiltrada.length;
    const modulosAuditoriaQtd = new Set(auditoriaFiltrada.map((l) => l.modulo)).size;
    const usuariosAuditoriaQtd = new Set(auditoriaFiltrada.map((l) => l.usuarioNome)).size;

    // 3. Agrupamento Unificado Geral por Combustível
    const PRODUTOS_PADRAO_LS = [
      'Gasolina Comum',
      'Gasolina Aditivada',
      'Etanol Hidratado',
      'Diesel S10',
      'Diesel S500',
    ];
    const conjuntoProdutosUnico = new Set<string>(
      filtroCombustivel !== 'TODOS' ? [filtroCombustivel] : PRODUTOS_PADRAO_LS
    );
    tanquesFiltrados.forEach((t) => { if (t.produto) conjuntoProdutosUnico.add(t.produto); });
    bicosFiltrados.forEach((b) => { if (b.produto) conjuntoProdutosUnico.add(b.produto); });
    afericoesFiltradas.forEach((a) => { if (a.produto) conjuntoProdutosUnico.add(a.produto); });
    analisesFiltradas.forEach((d) => { if (d.produto) conjuntoProdutosUnico.add(d.produto); });

    const agrupadoPorCombustivel = Array.from(conjuntoProdutosUnico).map((prod) => {
      const tanquesProd = tanquesFiltrados.filter((t) => t.produto === prod);
      const bicosProd = bicosFiltrados.filter((b) => b.produto === prod);
      const afericoesProd = afericoesFiltradas.filter((a) => a.produto === prod);
      const analisesProd = analisesFiltradas.filter((d) => d.produto === prod);

      const capNominalTotal = tanquesProd.reduce((acc, t) => acc + (Number(t.capacidadeNominal) || 0), 0);
      const volAtualTotal = tanquesProd.reduce((acc, t) => acc + (Number(t.volumeAtual) || 0), 0);
      const ocupacaoPorcentagem = capNominalTotal > 0 ? (volAtualTotal / capNominalTotal) * 100 : 0;

      const totalAfericoes = afericoesProd.length;
      const afericoesConformes = afericoesProd.filter((a) => a.resultado === 'CONFORME').length;
      const afericoesNaoConformes = totalAfericoes - afericoesConformes;
      const taxaInmetro = totalAfericoes > 0 ? ((afericoesConformes / totalAfericoes) * 100).toFixed(1) : '100.0';

      const volAferidoTotal = afericoesProd.reduce((acc, a) => acc + (Number(a.volumeAferido) || 20), 0);
      const desvioTotalMl = afericoesProd.reduce((acc, a) => acc + Math.round((Number(a.diferenca) || 0) * 1000), 0);
      const desvioMedioMl = totalAfericoes > 0 ? Math.round(desvioTotalMl / totalAfericoes) : 0;
      const impactoLitros1000L = Number(((desvioMedioMl * 50) / 1000).toFixed(2));

      const precoMedio = PRECOS_PADRAO_COMBUSTIVEL[prod] || 5.89;
      const valorTotalAfericao = volAferidoTotal * precoMedio;
      const impactoFinanceiro1000L = Number((impactoLitros1000L * precoMedio).toFixed(2));

      const totalAnalises = analisesProd.length;
      const analisesConformes = analisesProd.filter((d) => (d.resultado || (d as any).status) === 'CONFORME').length;
      const taxaAnp = totalAnalises > 0 ? ((analisesConformes / totalAnalises) * 100).toFixed(1) : '100.0';

      return {
        produto: prod,
        tanques: tanquesProd,
        bicos: bicosProd,
        afericoes: afericoesProd,
        densidades: analisesProd,
        capNominalTotal,
        volAtualTotal,
        ocupacaoPorcentagem,
        totalAfericoes,
        afericoesConformes,
        afericoesNaoConformes,
        taxaInmetro,
        volAferidoTotal,
        desvioMedioMl,
        impactoLitros1000L,
        impactoFinanceiro1000L,
        valorTotalAfericao,
        precoMedio,
        totalAnalises,
        analisesConformes,
        taxaAnp,
      };
    });

    return {
      totalFechamentos: fechamentosFiltrados.length,
      totalConferido,
      totalInformado,
      saldoDiferenca,
      totalSobras,
      totalFaltas,
      meiosPagamento,
      totalAfericoes,
      afericoesConformes,
      afericoesNaoConformes,
      taxaConformidade,
      volumeTotalNominal,
      volumeTotalAferido,
      desvioTotalMl,
      desvioMedioMl,
      valorTotalAfericoesGeral,
      impactoMedioGeralLitros1000L,
      impactoMedioGeralFinanceiro1000L,
      resumoPorCombustivel,
      resumoPorProduto: resumoPorCombustivel, // compatibilidade
      resumoPorBico,
      agrupadoPorCombustivel,
      totalAnalises,
      analisesConformes,
      analisesNaoConformes,
      taxaConformidadeAnalises,
      totalAuditoria,
      modulosAuditoriaQtd,
      usuariosAuditoriaQtd,
    };
  }, [
    fechamentosFiltrados,
    afericoesFiltradas,
    analisesFiltradas,
    auditoriaFiltrada,
    tanquesFiltrados,
    bicosFiltrados,
    filtroCombustivel,
    bicos,
  ]);

  // Agrupamento oficial das 5 Colunas Requisitadas:
  // 1. COMBUSTÍVEL | 2. QUANTIDADE | 3. VALOR UNITÁRIO | 4. VALOR TOTAL | 5. DESVIO
  const relatorioCombustiveis5Colunas = useMemo<ItemRelatorioCombustivel5Colunas[]>(() => {
    const PRODUTOS_PADRAO = [
      'Gasolina Comum',
      'Gasolina Aditivada',
      'Etanol Hidratado',
      'Diesel S10',
      'Diesel S500',
    ];

    const todosProdutos = new Set<string>();
    if (filtroCombustivel !== 'TODOS') {
      todosProdutos.add(filtroCombustivel);
    } else {
      PRODUTOS_PADRAO.forEach((p) => todosProdutos.add(p));
      listaCombustiveisDisponiveis.forEach((p) => todosProdutos.add(p));
      fechamentosFiltrados.forEach((f) => {
        f.encerrantesBicos?.forEach((b) => {
          if (b.produto) todosProdutos.add(b.produto);
        });
      });
    }

    return Array.from(todosProdutos).map((prod) => {
      // 1. Litros e Valores apurados nos fechamentos
      let litrosVendidosTotal = 0;
      let valorVendidoTotal = 0;
      let afericoesLitrosNosBicos = 0;

      fechamentosFiltrados.forEach((f) => {
        if (f.encerrantesBicos && f.encerrantesBicos.length > 0) {
          f.encerrantesBicos.forEach((b) => {
            if (b.produto === prod) {
              litrosVendidosTotal += Number(b.litrosVendidos) || 0;
              valorVendidoTotal += Number(b.valorTotal) || 0;
              afericoesLitrosNosBicos += Number(b.afericaoLitros) || 0;
            }
          });
        }
      });

      // 2. Preço de Referência
      const precoUnitarioPadrao = resolverPrecoBico(undefined, undefined, prod);

      // Fallback se não houver encerrantes nos fechamentos
      if (litrosVendidosTotal === 0) {
        const bicosDoProduto = bicosFiltrados.filter((b) => b.produto === prod);
        const somaEnc = bicosDoProduto.reduce((s, b) => s + (b.encerranteAtual || 0), 0);
        if (somaEnc > 0) {
          litrosVendidosTotal = somaEnc;
          valorVendidoTotal = litrosVendidosTotal * precoUnitarioPadrao;
        } else {
          const afericoesProd = afericoesFiltradas.filter((a) => a.produto === prod);
          if (afericoesProd.length > 0) {
            litrosVendidosTotal = afericoesProd.reduce((s, a) => s + (Number(a.volumeAferido) || 20), 0);
            valorVendidoTotal = litrosVendidosTotal * precoUnitarioPadrao;
          }
        }
      }

      const valorUnitario =
        litrosVendidosTotal > 0 && valorVendidoTotal > 0
          ? Number((valorVendidoTotal / litrosVendidosTotal).toFixed(2))
          : precoUnitarioPadrao;

      // 3. Apuração de Desvio
      const afericoesProd = afericoesFiltradas.filter((a) => a.produto === prod);
      const desvioMlTotal = afericoesProd.reduce(
        (s, a) => s + Math.round((Number(a.diferenca) || 0) * 1000),
        0
      );
      const desvioLitrosAfericao = Number(((desvioMlTotal * 50) / 1000).toFixed(2));
      const desvioLitros = afericoesLitrosNosBicos > 0 ? afericoesLitrosNosBicos : desvioLitrosAfericao;

      let statusDesvio: 'REGULAR' | 'SOBRA' | 'FALTA' = 'REGULAR';
      if (desvioLitros > 0 || desvioMlTotal > 0) statusDesvio = 'SOBRA';
      else if (desvioLitros < 0 || desvioMlTotal < 0) statusDesvio = 'FALTA';

      let desvioTexto = '0,00 L (Regular)';
      if (desvioLitros !== 0 && desvioMlTotal !== 0) {
        const sL = desvioLitros > 0 ? '+' : '';
        const sMl = desvioMlTotal > 0 ? '+' : '';
        desvioTexto = `${sL}${desvioLitros.toFixed(2)} L (${sMl}${desvioMlTotal} ml)`;
      } else if (desvioLitros !== 0) {
        const sL = desvioLitros > 0 ? '+' : '';
        desvioTexto = `${sL}${desvioLitros.toFixed(2)} L`;
      } else if (desvioMlTotal !== 0) {
        const sMl = desvioMlTotal > 0 ? '+' : '';
        desvioTexto = `${sMl}${desvioMlTotal} ml`;
      }

      return {
        produto: prod,
        quantidade: Number(litrosVendidosTotal.toFixed(2)),
        valorUnitario,
        valorTotal: Number(valorVendidoTotal.toFixed(2)),
        desvioTexto,
        desvioLitros,
        desvioMl: desvioMlTotal,
        statusDesvio,
      };
    });
  }, [
    filtroCombustivel,
    listaCombustiveisDisponiveis,
    fechamentosFiltrados,
    bicosFiltrados,
    afericoesFiltradas,
    bicos,
  ]);

  /**
   * Exportação do Relatório Simplificado de Combustíveis nas 5 Colunas Solicitadas
   */
  const handleExportarCombustivel5ColunasPDF = (formato: 'MOBILE' | 'A4' = 'MOBILE') => {
    try {
      setGerandoPdf(true);
      const periodoTexto = `${formatarDataBR(dataInicio)} a ${formatarDataBR(dataFim)}`;
      exportarRelatorioCombustivel5ColunasPDF({
        dados: relatorioCombustiveis5Colunas,
        periodo: periodoTexto,
        formato,
        nomeArquivo: `Relatorio_Combustiveis_${formato === 'MOBILE' ? 'Mobile_' : ''}${dataInicio}_a_${dataFim}.pdf`,
      });
    } catch (err) {
      console.error('Falha ao exportar PDF de combustíveis 5 colunas:', err);
    } finally {
      setGerandoPdf(false);
    }
  };

  const handleImprimir = () => {
    window.print();
  };

  /**
   * Atalhos de período de 1 toque para facilitar a rotina do fiscal e do gerente no celular
   */
  const aplicarFiltroRapido = (periodo: 'HOJE' | 'ONTEM' | '7DIAS' | 'MES_ATUAL') => {
    const hoje = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    if (periodo === 'HOJE') {
      const hojeStr = toIso(hoje);
      setDataInicio(hojeStr);
      setDataFim(hojeStr);
    } else if (periodo === 'ONTEM') {
      const ontem = new Date(hoje);
      ontem.setDate(hoje.getDate() - 1);
      const ontemStr = toIso(ontem);
      setDataInicio(ontemStr);
      setDataFim(ontemStr);
    } else if (periodo === '7DIAS') {
      const seteDiasAtras = new Date(hoje);
      seteDiasAtras.setDate(hoje.getDate() - 6);
      setDataInicio(toIso(seteDiasAtras));
      setDataFim(toIso(hoje));
    } else if (periodo === 'MES_ATUAL') {
      const primeiroDia = `${hoje.getFullYear()}-${pad(hoje.getMonth() + 1)}-01`;
      const ultimoDia = `${hoje.getFullYear()}-${pad(hoje.getMonth() + 1)}-${pad(
        new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate()
      )}`;
      setDataInicio(primeiroDia);
      setDataFim(ultimoDia);
    }
  };

  /**
   * Exporta o relatório simplificado e otimizado para Smartphone e WhatsApp (PDF 9:16)
   */
  const handleGerarPdfMobile = (tipoForcado?: TipoRelatorio) => {
    setGerandoPdf(true);
    try {
      const relatorioAlvo = tipoForcado || tipo;
      const periodoTexto = `${formatarDataBR(dataInicio)} a ${formatarDataBR(dataFim)}`;

      gerarRelatorioMobilePDF({
        titulo:
          relatorioAlvo === 'BALANCO_CONSOLIDADO'
            ? 'RESUMO EXECUTIVO DO POSTO'
            : `RELATÓRIO OPERACIONAL: ${relatorioAlvo}`,
        subtitulo: `Período: ${periodoTexto} · Otimizado para Smartphone & WhatsApp`,
        periodo: periodoTexto,
        kpis: {
          totalFaturado: balancoConsolidado.totalInformado,
          totalConferido: balancoConsolidado.totalConferido,
          totalDiferenca: balancoConsolidado.saldoDiferenca,
          totalFechamentos: balancoConsolidado.totalFechamentos,
          volumeTotalLitros: balancoConsolidado.volumeTotalAferido,
          totalAfericoes: balancoConsolidado.totalAfericoes,
          afericoesConformes: balancoConsolidado.afericoesConformes,
          desvioMedioMl: balancoConsolidado.desvioMedioMl,
          totalAnalises: balancoConsolidado.totalAnalises,
          analisesConformes: balancoConsolidado.analisesConformes,
        },
        meiosPagamento: balancoConsolidado.meiosPagamento,
        fechamentos: fechamentosFiltrados.map((f) => ({
          data: f.data,
          turno: f.turno,
          funcionarioNome: f.funcionarioNome || 'Operador',
          totalInformado: f.totalInformado,
          totalConferido: f.totalConferido,
          diferenca: f.diferenca,
          status: f.status,
          conferidoPor: f.conferidoPor,
          pagamentos: {
            dinheiro: f.dinheiro,
            cartaoCredito: f.cartaoCredito,
            cartaoDebito: f.cartaoDebito,
            pix: f.pix,
            outros: f.outros,
          },
        })),
        combustiveis: relatorioCombustiveis5Colunas.map((c) => ({
          produto: c.produto,
          volumeLitros: c.quantidade,
          valorUnitario: c.valorUnitario,
          valorTotal: c.valorTotal,
          desvioTexto: c.desvioTexto,
          desvioLitros: c.desvioLitros,
          desvioMl: c.desvioMl,
          statusDesvio: c.statusDesvio,
          precoMedio: c.valorUnitario,
        })),
        afericoes: afericoesFiltradas.map((a) => ({
          data: a.data,
          bicoNome: a.bicoNome || `Bico ${a.bicoId}`,
          produto: a.produto || 'Combustível',
          volumeNominal: a.volumeNominal || 20,
          volumeAferido: a.volumeAferido || 20,
          diferencaMl: Math.round((Number(a.diferenca) || 0) * 1000),
          status: a.resultado || 'CONFORME',
          responsavel: a.responsavel,
        })),
        escalas: escalasFiltradas.map((e) => ({
          data: e.data,
          funcionarioNome: e.funcionarioNome || 'Colaborador',
          turno: e.turno || 'T1',
          horarioInicio: e.horarioInicio,
          horarioFim: e.horarioFim,
          status: e.status || 'TRABALHO',
        })),
        nomeArquivo: `Relatorio_Mobile_${relatorioAlvo}_${dataInicio}_a_${dataFim}.pdf`,
      });
    } catch (err) {
      console.error('Falha ao exportar PDF Mobile:', err);
    } finally {
      setGerandoPdf(false);
    }
  };

  /**
   * Exportação nativa em PDF do Balanço Consolidado de Fechamentos de Caixa e Aferições Metrológicas
   * (ou do módulo específico selecionado)
   */
  const handleExportarPDF = (modoForcado?: TipoRelatorio) => {
    setGerandoPdf(true);
    try {
      const relatorioAlvo = modoForcado || tipo;
      const doc = new jsPDF({
        orientation: relatorioAlvo === 'ESCALAS' ? 'landscape' : 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const dataHoraEmissao = new Date().toLocaleString('pt-BR');

      // Cabeçalho Institucional
      doc.setFillColor(15, 23, 42); // slate-900
      doc.rect(0, 0, pageWidth, 28, 'F');

      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text(
        relatorioAlvo === 'BALANCO_CONSOLIDADO'
          ? 'MEU POSTO 2.0 — RELATÓRIO GERAL: FECHAMENTO, AUDITORIA, ANÁLISE & AFERIÇÕES'
          : `MEU POSTO 2.0 — RELATÓRIO OPERACIONAL: ${relatorioAlvo}`,
        14,
        12
      );

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(203, 213, 225);
      doc.text(
        `Período: ${dataInicio || 'Início'} até ${dataFim || 'Atual'}   |   Emitido em: ${dataHoraEmissao}   |   Documento Auditável 24h`,
        14,
        20
      );

      let currentY = 34;

      // VISÃO GERAL EXECUTIVA DOS 4 PILARES (No Balanço Consolidado)
      if (relatorioAlvo === 'BALANCO_CONSOLIDADO') {
        autoTable(doc, {
          startY: currentY,
          head: [
            [
              '1. FECHAMENTO DE CAIXA',
              '2. AFERIÇÕES METROLÓGICAS (20L)',
              '3. ANÁLISES & QUALIDADE ANP',
              '4. TRILHA DE AUDITORIA',
            ],
          ],
          body: [
            [
              `Turnos: ${balancoConsolidado.totalFechamentos}\nBombas: ${formatarMoeda(balancoConsolidado.totalConferido)}\nRecolhido: ${formatarMoeda(balancoConsolidado.totalInformado)}\nSaldo: ${formatarMoeda(balancoConsolidado.saldoDiferenca)}`,
              `Testes 20L: ${balancoConsolidado.totalAfericoes}\nVol. Total: ${balancoConsolidado.volumeTotalAferido.toFixed(1)} L (${formatarMoeda(balancoConsolidado.valorTotalAfericoesGeral)})\nDesvio Médio: ${balancoConsolidado.desvioMedioMl > 0 ? '+' : ''}${balancoConsolidado.desvioMedioMl} ml\nImpacto 1.000L: ${balancoConsolidado.impactoMedioGeralLitros1000L > 0 ? '+' : ''}${balancoConsolidado.impactoMedioGeralLitros1000L.toFixed(2)} L/m³`,
              `Ensaios: ${balancoConsolidado.totalAnalises}\nConformes: ${balancoConsolidado.analisesConformes} (${balancoConsolidado.taxaConformidadeAnalises}%)\nNorma NBR 5992 / ANP\nGasolina / Etanol / Diesel`,
              `Eventos: ${balancoConsolidado.totalAuditoria}\nMódulos: ${balancoConsolidado.modulosAuditoriaQtd}\nOperadores: ${balancoConsolidado.usuariosAuditoriaQtd}\n100% Rastreado em Nuvem`,
            ],
          ],
          theme: 'grid',
          headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8, fontStyle: 'bold', halign: 'center' },
          bodyStyles: { fontSize: 7.5, textColor: [30, 41, 59], cellPadding: 2.5, fontStyle: 'bold' },
          margin: { left: 14, right: 14 },
        });

        currentY = (doc as any).lastAutoTable.finalY + 8;
      }

      // 1. SEÇÃO DE FECHAMENTOS (Para BALANCO_CONSOLIDADO ou FECHAMENTOS)
      if (relatorioAlvo === 'BALANCO_CONSOLIDADO' || relatorioAlvo === 'FECHAMENTOS') {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(15, 23, 42);
        doc.text('1. BALANÇO FINANCEIRO CONSOLIDADO — FECHAMENTOS DE CAIXA', 14, currentY);
        currentY += 4;

        // Resumo Executivo de Fechamentos
        autoTable(doc, {
          startY: currentY,
          head: [
            [
              'Qtd. Fechamentos',
              'Total Bombas (Conferido)',
              'Total Recolhido (Informado)',
              'Total Sobras (+)',
              'Total Faltas (-)',
              'Saldo Líquido',
            ],
          ],
          body: [
            [
              String(balancoConsolidado.totalFechamentos),
              formatarMoeda(balancoConsolidado.totalConferido),
              formatarMoeda(balancoConsolidado.totalInformado),
              formatarMoeda(balancoConsolidado.totalSobras),
              formatarMoeda(balancoConsolidado.totalFaltas),
              formatarMoeda(balancoConsolidado.saldoDiferenca),
            ],
          ],
          theme: 'grid',
          headStyles: { fillColor: [30, 64, 175], textColor: 255, fontSize: 8, fontStyle: 'bold' },
          bodyStyles: { fontSize: 8.5, fontStyle: 'bold', textColor: [15, 23, 42] },
          margin: { left: 14, right: 14 },
        });

        currentY = (doc as any).lastAutoTable.finalY + 5;

        // Composição por Meio de Pagamento
        autoTable(doc, {
          startY: currentY,
          head: [
            [
              'PIX Pista',
              'Cartões (Deb/Cred)',
              'Dinheiro / Depósito',
              'Notas a Prazo',
              'PIX CNPJ',
              'Despesas / Vales',
              'Outros',
            ],
          ],
          body: [
            [
              formatarMoeda(balancoConsolidado.meiosPagamento.pix),
              formatarMoeda(balancoConsolidado.meiosPagamento.cartao),
              formatarMoeda(balancoConsolidado.meiosPagamento.deposito),
              formatarMoeda(balancoConsolidado.meiosPagamento.nota),
              formatarMoeda(balancoConsolidado.meiosPagamento.pixCnpj),
              formatarMoeda(balancoConsolidado.meiosPagamento.despesa),
              formatarMoeda(balancoConsolidado.meiosPagamento.outros),
            ],
          ],
          theme: 'striped',
          headStyles: { fillColor: [71, 85, 105], textColor: 255, fontSize: 7.5 },
          bodyStyles: { fontSize: 8 },
          margin: { left: 14, right: 14 },
        });

        currentY = (doc as any).lastAutoTable.finalY + 6;

        // Listagem Detalhada de Fechamentos de Caixa
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(51, 65, 85);
        doc.text(
          `Detalhamento de Fechamentos de Caixa no Período (${fechamentosFiltrados.length} registros)`,
          14,
          currentY
        );
        currentY += 3;

        autoTable(doc, {
          startY: currentY,
          head: [
            [
              'Data',
              'Turno',
              'Operador / Responsável',
              'Total Bombas',
              'Total Informado',
              'Diferença',
              'Resultado',
            ],
          ],
          body:
            fechamentosFiltrados.length > 0
              ? fechamentosFiltrados.map((f) => [
                  f.data,
                  f.turno || '—',
                  f.funcionarioNome || 'Operador',
                  formatarMoeda(f.totalConferido),
                  formatarMoeda(f.totalInformado),
                  formatarMoeda(f.diferenca),
                  f.tipoDiferenca || (f.diferenca < 0 ? 'FALTA' : f.diferenca > 0 ? 'SOBRA' : 'EXATO'),
                ])
              : [['—', '—', 'Nenhum fechamento registrado no período selecionado', 'R$ 0,00', 'R$ 0,00', 'R$ 0,00', '—']],
          foot:
            fechamentosFiltrados.length > 0
              ? [
                  [
                    'TOTAL',
                    `${fechamentosFiltrados.length} turnos`,
                    'Consolidado do Período',
                    formatarMoeda(balancoConsolidado.totalConferido),
                    formatarMoeda(balancoConsolidado.totalInformado),
                    formatarMoeda(balancoConsolidado.saldoDiferenca),
                    balancoConsolidado.saldoDiferenca < 0
                      ? 'SALDO NEGATIVO'
                      : balancoConsolidado.saldoDiferenca > 0
                      ? 'SALDO POSITIVO'
                      : 'ZERADO',
                  ],
                ]
              : undefined,
          theme: 'grid',
          headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8 },
          bodyStyles: { fontSize: 7.5 },
          footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontSize: 8, fontStyle: 'bold' },
          margin: { left: 14, right: 14 },
        });

        currentY = (doc as any).lastAutoTable.finalY + 10;
      }

      // 2. SEÇÃO DE AFERIÇÕES (Para BALANCO_CONSOLIDADO ou AFERICOES)
      if (relatorioAlvo === 'BALANCO_CONSOLIDADO' || relatorioAlvo === 'AFERICOES') {
        if (currentY > 195) {
          doc.addPage();
          currentY = 20;
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(15, 23, 42);
        doc.text('2. AUDITORIA DE AFERIÇÕES METROLÓGICAS — IMPACTO EM 1.000 L (COLEÇÃO \'AFERICOES\')', 14, currentY);
        currentY += 4;

        // Resumo Executivo de Aferições
        autoTable(doc, {
          startY: currentY,
          head: [
            [
              'Total Aferições',
              'Conformes (±100ml)',
              'Não Conformes',
              'Volume Total Aferido',
              'Valor Total Aferições',
              'Desvio Médio (20L)',
              'Impacto Geral / 1.000 L',
            ],
          ],
          body: [
            [
              String(balancoConsolidado.totalAfericoes),
              `${balancoConsolidado.afericoesConformes} (${balancoConsolidado.taxaConformidade}%)`,
              String(balancoConsolidado.afericoesNaoConformes),
              `${balancoConsolidado.volumeTotalAferido.toFixed(3)} L`,
              formatarMoeda(balancoConsolidado.valorTotalAfericoesGeral),
              `${balancoConsolidado.desvioMedioMl > 0 ? '+' : ''}${balancoConsolidado.desvioMedioMl} ml`,
              `${balancoConsolidado.impactoMedioGeralLitros1000L > 0 ? '+' : ''}${balancoConsolidado.impactoMedioGeralLitros1000L.toFixed(2)} L (${formatarMoeda(balancoConsolidado.impactoMedioGeralFinanceiro1000L)})`,
            ],
          ],
          theme: 'grid',
          headStyles: { fillColor: [5, 150, 105], textColor: 255, fontSize: 7.5, fontStyle: 'bold' },
          bodyStyles: { fontSize: 8, fontStyle: 'bold', textColor: [15, 23, 42] },
          margin: { left: 14, right: 14 },
        });

        currentY = (doc as any).lastAutoTable.finalY + 6;

        // 2.1 TABELA POR TIPO DE COMBUSTÍVEL COM VALOR TOTAL E IMPACTO EM 1.000 L
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(51, 65, 85);
        doc.text('2.1. Valor Total e Impacto por Tipo de Combustível em 1.000 L de Abastecimento', 14, currentY);
        currentY += 3;

        autoTable(doc, {
          startY: currentY,
          head: [
            [
              'Combustível / Produto',
              'Bicos Aferidos',
              'Testes',
              'Volume (L)',
              'Preço Médio',
              'Valor Total Aferição',
              'Desvio Médio (20L)',
              'Impacto Litros / 1.000 L',
              'Impacto R$ / 1.000 L',
              'Status Inmetro',
            ],
          ],
          body:
            balancoConsolidado.resumoPorCombustivel.length > 0
              ? balancoConsolidado.resumoPorCombustivel.map((c) => [
                  c.produto,
                  `Bico(s): ${c.bicosNumeros.map((n) => String(n).padStart(2, '0')).join(', ')}`,
                  String(c.qtdTestes),
                  `${c.volumeAferidoTotal.toFixed(3)} L`,
                  formatarMoeda(c.precoMedioLitro),
                  formatarMoeda(c.valorTotalAfericao),
                  `${c.desvioMedioMl > 0 ? '+' : ''}${c.desvioMedioMl} ml`,
                  `${c.impactoLitrosPor1000L > 0 ? '+' : ''}${c.impactoLitrosPor1000L.toFixed(2)} L (${c.impactoLitrosPor1000L > 0 ? 'Sobra +' : c.impactoLitrosPor1000L < 0 ? 'Déficit -' : 'Exato'})`,
                  `${c.impactoFinanceiroPor1000L > 0 ? '+' : ''}${formatarMoeda(c.impactoFinanceiroPor1000L)} / 1.000L`,
                  `${c.conformes} de ${c.qtdTestes} (${c.taxaConformidade}%)`,
                ])
              : [['Nenhum teste de combustível', '—', '0', '0.000 L', 'R$ 0,00', 'R$ 0,00', '0 ml', '0.00 L', 'R$ 0,00', '—']],
          foot:
            balancoConsolidado.resumoPorCombustivel.length > 0
              ? [
                  [
                    'TOTAL CONSOLIDADO',
                    `${new Set(afericoesFiltradas.map((a) => a.bicoNumero || a.bicoId)).size} bicos`,
                    String(balancoConsolidado.totalAfericoes),
                    `${balancoConsolidado.volumeTotalAferido.toFixed(3)} L`,
                    '—',
                    formatarMoeda(balancoConsolidado.valorTotalAfericoesGeral),
                    `${balancoConsolidado.desvioMedioMl > 0 ? '+' : ''}${balancoConsolidado.desvioMedioMl} ml`,
                    `${balancoConsolidado.impactoMedioGeralLitros1000L > 0 ? '+' : ''}${balancoConsolidado.impactoMedioGeralLitros1000L.toFixed(2)} L`,
                    `${balancoConsolidado.impactoMedioGeralFinanceiro1000L > 0 ? '+' : ''}${formatarMoeda(balancoConsolidado.impactoMedioGeralFinanceiro1000L)} / 1.000L`,
                    `${balancoConsolidado.taxaConformidade}% conf.`,
                  ],
                ]
              : undefined,
          theme: 'grid',
          headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 7, fontStyle: 'bold' },
          bodyStyles: { fontSize: 7 },
          footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontSize: 7, fontStyle: 'bold' },
          margin: { left: 14, right: 14 },
        });

        currentY = (doc as any).lastAutoTable.finalY + 6;

        // 2.2 TABELA CONSOLIDADA DE INFORMAÇÕES DE BICOS AFERIDOS
        if (currentY > 200) {
          doc.addPage();
          currentY = 20;
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(51, 65, 85);
        doc.text('2.2. Informações de Bicos Aferidos & Valor Total por Bico', 14, currentY);
        currentY += 3;

        autoTable(doc, {
          startY: currentY,
          head: [
            [
              'Bico / Bomba',
              'Combustível',
              'Testes',
              'Vol. Total (L)',
              'Preço (R$/L)',
              'Valor Total (R$)',
              'Desvio Médio',
              'Impacto 1.000 L',
              'Status',
            ],
          ],
          body:
            balancoConsolidado.resumoPorBico.length > 0
              ? balancoConsolidado.resumoPorBico.map((b) => [
                  `Bico ${String(b.bicoNumero).padStart(2, '0')}\n${b.bombaNome}`,
                  b.produto,
                  String(b.qtdTestes),
                  `${b.volumeAferidoTotal.toFixed(3)} L`,
                  formatarMoeda(b.precoLitro),
                  formatarMoeda(b.valorTotalAfericao),
                  `${b.desvioMedioMl > 0 ? '+' : ''}${b.desvioMedioMl} ml`,
                  `${b.impactoLitrosPor1000L > 0 ? '+' : ''}${b.impactoLitrosPor1000L.toFixed(2)} L\n(${b.impactoFinanceiroPor1000L > 0 ? '+' : ''}${formatarMoeda(b.impactoFinanceiroPor1000L)})`,
                  b.statusGeral,
                ])
              : [['—', '—', '0', '0.000 L', 'R$ 0,00', 'R$ 0,00', '0 ml', '0.00 L', '—']],
          foot:
            balancoConsolidado.resumoPorBico.length > 0
              ? [
                  [
                    'TOTAL',
                    '—',
                    String(balancoConsolidado.totalAfericoes),
                    `${balancoConsolidado.volumeTotalAferido.toFixed(3)} L`,
                    '—',
                    formatarMoeda(balancoConsolidado.valorTotalAfericoesGeral),
                    `${balancoConsolidado.desvioMedioMl > 0 ? '+' : ''}${balancoConsolidado.desvioMedioMl} ml`,
                    `${balancoConsolidado.impactoMedioGeralLitros1000L > 0 ? '+' : ''}${balancoConsolidado.impactoMedioGeralLitros1000L.toFixed(2)} L`,
                    `${balancoConsolidado.afericoesConformes} conf.`,
                  ],
                ]
              : undefined,
          theme: 'grid',
          headStyles: { fillColor: [51, 65, 85], textColor: 255, fontSize: 6.5, fontStyle: 'bold' },
          bodyStyles: { fontSize: 6.5 },
          footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontSize: 6.5, fontStyle: 'bold' },
          margin: { left: 14, right: 14 },
        });

        currentY = (doc as any).lastAutoTable.finalY + 6;

        // 2.3 DETALHAMENTO DE CADA ENSAIO INDIVIDUAL DE AFERIÇÃO (AGRUPADO OU CRONOLÓGICO)
        if (currentY > 200) {
          doc.addPage();
          currentY = 20;
        }

        if (agrupamentoAfericoes === 'COMBUSTIVEL' && balancoConsolidado.resumoPorCombustivel.length > 0) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9.5);
          doc.setTextColor(51, 65, 85);
          doc.text(
            `2.3. Detalhamento de Ensaios Volumétricos Agrupados por Combustível (${afericoesFiltradas.length} testes)`,
            14,
            currentY
          );
          currentY += 4;

          balancoConsolidado.resumoPorCombustivel.forEach((comb: any) => {
            const testes = comb.listaAfericoes || [];
            if (testes.length === 0) return;

            if (currentY > 210) {
              doc.addPage();
              currentY = 20;
            }

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.setTextColor(30, 41, 59);
            doc.text(
              `• ${comb.produto} (${comb.qtdTestes} testes • Vol: ${comb.volumeAferidoTotal.toFixed(3)} L • Desvio: ${comb.desvioMedioMl > 0 ? '+' : ''}${comb.desvioMedioMl} ml • ${comb.taxaConformidade}% conf. • Total: ${formatarMoeda(comb.valorTotalAfericao)})`,
              14,
              currentY
            );
            currentY += 2;

            autoTable(doc, {
              startY: currentY,
              head: [
                [
                  'Data / Hora',
                  'Bico',
                  'Vol. Nominal',
                  'Vol. Aferido',
                  'Desvio (ml)',
                  'Valor Teste (R$)',
                  'Responsável',
                  'Status Inmetro',
                ],
              ],
              body: testes.map((a: any) => {
                const bicoNum =
                  a.bicoNumero ?? (a.bicoId ? parseInt(a.bicoId.replace(/\D/g, ''), 10) : 1);
                return [
                  `${a.data} ${a.hora || ''}`.trim(),
                  `Bico ${String(bicoNum).padStart(2, '0')}`,
                  `${Number(a.volumeNominal || 20).toFixed(3)} L`,
                  `${Number(a.volumeAferido || 20).toFixed(3)} L`,
                  `${a.desvioMl > 0 ? '+' : ''}${a.desvioMl} ml`,
                  formatarMoeda(a.valorTeste),
                  a.responsavelNome || 'Operador',
                  a.resultado,
                ];
              }),
              foot: [
                [
                  `Subtotal ${comb.produto}`,
                  '—',
                  `${(testes.length * 20).toFixed(3)} L`,
                  `${comb.volumeAferidoTotal.toFixed(3)} L`,
                  `${comb.desvioMedioMl > 0 ? '+' : ''}${comb.desvioMedioMl} ml méd.`,
                  formatarMoeda(comb.valorTotalAfericao),
                  '—',
                  `${comb.conformes} de ${testes.length} conf.`,
                ],
              ],
              theme: 'grid',
              headStyles: { fillColor: [51, 65, 85], textColor: 255, fontSize: 6.5 },
              bodyStyles: { fontSize: 6.5 },
              footStyles: {
                fillColor: [241, 245, 249],
                textColor: [15, 23, 42],
                fontSize: 6.5,
                fontStyle: 'bold',
              },
              margin: { left: 14, right: 14 },
            });

            currentY = (doc as any).lastAutoTable.finalY + 5;
          });
          currentY += 4;
        } else {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9.5);
          doc.setTextColor(51, 65, 85);
          doc.text(
            `2.3. Detalhamento Técnico de Ensaios Volumétricos Individuais (${afericoesFiltradas.length} testes)`,
            14,
            currentY
          );
          currentY += 3;

          autoTable(doc, {
            startY: currentY,
            head: [
              [
                'Data / Hora',
                'Bico',
                'Combustível',
                'Vol. Nominal',
                'Vol. Aferido',
                'Desvio (ml)',
                'Valor Teste (R$)',
                'Responsável',
                'Status Inmetro',
              ],
            ],
            body:
              afericoesFiltradas.length > 0
                ? afericoesFiltradas.map((a) => {
                    const desvioMl = Math.round((Number(a.diferenca) || 0) * 1000);
                    const bicoNum =
                      a.bicoNumero ?? (a.bicoId ? parseInt(a.bicoId.replace(/\D/g, ''), 10) : 1);
                    const preco = resolverPrecoBico(a.bicoId, bicoNum, a.produto);
                    const valTeste = (Number(a.volumeNominal) || 20) * preco;

                    return [
                      `${a.data} ${a.hora || ''}`.trim(),
                      `Bico ${String(bicoNum).padStart(2, '0')}`,
                      a.produto,
                      `${Number(a.volumeNominal || 20).toFixed(3)} L`,
                      `${Number(a.volumeAferido || 20).toFixed(3)} L`,
                      `${desvioMl > 0 ? '+' : ''}${desvioMl} ml`,
                      formatarMoeda(valTeste),
                      a.responsavelNome || 'Operador',
                      a.resultado,
                    ];
                  })
                : [['—', '—', '—', '20.000 L', '20.000 L', '0 ml', 'R$ 0,00', '—', '—']],
            theme: 'grid',
            headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 6.5 },
            bodyStyles: { fontSize: 6.5 },
            margin: { left: 14, right: 14 },
          });

          currentY = (doc as any).lastAutoTable.finalY + 10;
        }
      }

      // 3. SEÇÃO DE ANÁLISES FÍSICO-QUÍMICAS & CONFORMIDADE REGULATÓRIA ANP
      if (
        relatorioAlvo === 'BALANCO_CONSOLIDADO' ||
        relatorioAlvo === 'DENSIDADES' ||
        relatorioAlvo === 'ANALISES'
      ) {
        if (currentY > 215) {
          doc.addPage();
          currentY = 20;
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(15, 23, 42);
        doc.text(
          '3. BALANÇO DE QUALIDADE & CONFORMIDADE REGULATÓRIA ANP (NBR 5992)',
          14,
          currentY
        );
        currentY += 4;

        // Resumo Executivo de Análises ANP
        autoTable(doc, {
          startY: currentY,
          head: [
            [
              'Total de Ensaios',
              'Amostras Conformes',
              'Fora de Faixa ANP',
              'Índice de Qualidade',
              'Padrão Regulatório',
            ],
          ],
          body: [
            [
              String(balancoConsolidado.totalAnalises),
              String(balancoConsolidado.analisesConformes),
              String(balancoConsolidado.analisesNaoConformes),
              `${balancoConsolidado.taxaConformidadeAnalises}%`,
              'Resoluções ANP / NBR 5992 (Ago 2026)',
            ],
          ],
          theme: 'grid',
          headStyles: { fillColor: [109, 40, 217], textColor: 255, fontSize: 8, fontStyle: 'bold' },
          bodyStyles: { fontSize: 8.5, fontStyle: 'bold', textColor: [15, 23, 42] },
          margin: { left: 14, right: 14 },
        });

        currentY = (doc as any).lastAutoTable.finalY + 6;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(51, 65, 85);
        doc.text(
          `Detalhamento Técnico de Ensaios e Laudos ANP (${analisesFiltradas.length} registros)`,
          14,
          currentY
        );
        currentY += 3;

        autoTable(doc, {
          startY: currentY,
          head: [
            [
              'Data / Hora',
              'Combustível',
              'Ensaio / Teste',
              'Densidade Lida',
              'Temp (°C)',
              'Densidade 20°C',
              'Faixa Permitida',
              'Teor / Parâmetro',
              'Laudo ANP',
            ],
          ],
          body:
            analisesFiltradas.length > 0
              ? analisesFiltradas.map((d) => {
                  const tempVal = d.temperatura ?? (d as any).temperaturaC ?? 20;
                  const densObs =
                    typeof d.densidadeObservada === 'number'
                      ? d.densidadeObservada.toFixed(4)
                      : String(d.densidadeObservada || '—');
                  const dens20 =
                    typeof d.densidadeCalculada20C === 'number'
                      ? d.densidadeCalculada20C.toFixed(4)
                      : typeof d.densidadeObservada === 'number'
                      ? d.densidadeObservada.toFixed(4)
                      : '—';
                  const faixa =
                    d.densidadeReferenciaMin && d.densidadeReferenciaMax
                      ? `${d.densidadeReferenciaMin.toFixed(3)} - ${d.densidadeReferenciaMax.toFixed(3)}`
                      : 'Faixa ANP';
                  const paramExtra = d.teorEtanolAnidro
                    ? `${d.teorEtanolAnidro}% Etanol`
                    : (d as any).teorAlcoolico !== undefined
                    ? `${(d as any).teorAlcoolico}% Etanol`
                    : d.condutividadeEletrica
                    ? `${d.condutividadeEletrica} µS/m`
                    : d.ph
                    ? `pH ${d.ph}`
                    : '—';
                  const laudo = d.resultado || (d as any).status || 'CONFORME';

                  return [
                    `${d.data} ${d.hora || ''}`.trim(),
                    d.produto || 'Combustível',
                    (d.tipoTeste || 'DENSIDADE_D20').replace(/_/g, ' '),
                    densObs,
                    `${tempVal} °C`,
                    dens20,
                    faixa,
                    paramExtra,
                    laudo,
                  ];
                })
              : [
                  [
                    '—',
                    '—',
                    'Nenhuma análise físico-química registrada no período selecionado',
                    '—',
                    '—',
                    '—',
                    '—',
                    '—',
                    '—',
                  ],
                ],
          theme: 'grid',
          headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 7.5 },
          bodyStyles: { fontSize: 7 },
          margin: { left: 14, right: 14 },
        });

        currentY = (doc as any).lastAutoTable.finalY + 10;
      }

      // 4. SEÇÃO DE AUDITORIA & REGISTROS DE SEGURANÇA
      if (relatorioAlvo === 'BALANCO_CONSOLIDADO' || relatorioAlvo === 'AUDITORIA') {
        if (currentY > 215) {
          doc.addPage();
          currentY = 20;
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(15, 23, 42);
        doc.text('4. TRILHA DE AUDITORIA & REGISTROS DE SEGURANÇA OPERACIONAL', 14, currentY);
        currentY += 4;

        // Resumo de Auditoria
        autoTable(doc, {
          startY: currentY,
          head: [
            [
              'Total de Eventos Auditados',
              'Módulos Impactados',
              'Usuários Identificados',
              'Integridade da Trilha',
            ],
          ],
          body: [
            [
              String(balancoConsolidado.totalAuditoria),
              String(balancoConsolidado.modulosAuditoriaQtd),
              String(balancoConsolidado.usuariosAuditoriaQtd),
              '100% Criptografado & Auditável em Nuvem',
            ],
          ],
          theme: 'grid',
          headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 8, fontStyle: 'bold' },
          bodyStyles: { fontSize: 8.5, fontStyle: 'bold', textColor: [15, 23, 42] },
          margin: { left: 14, right: 14 },
        });

        currentY = (doc as any).lastAutoTable.finalY + 6;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(51, 65, 85);
        doc.text(
          `Histórico Cronológico de Auditoria no Período (${auditoriaFiltrada.length} eventos)`,
          14,
          currentY
        );
        currentY += 3;

        autoTable(doc, {
          startY: currentY,
          head: [
            [
              'Data / Hora',
              'Usuário Responsável',
              'Módulo Operacional',
              'Entidade Afetada',
              'Ação Executada',
            ],
          ],
          body:
            auditoriaFiltrada.length > 0
              ? auditoriaFiltrada.map((l) => [
                  l.timestamp ? new Date(l.timestamp).toLocaleString('pt-BR') : '—',
                  l.usuarioNome || 'Operador',
                  l.modulo || 'Geral',
                  l.entidade || 'Sistema',
                  l.acao || 'REGISTRO',
                ])
              : [
                  [
                    '—',
                    '—',
                    'Nenhum evento de auditoria registrado no período selecionado',
                    '—',
                    '—',
                  ],
                ],
          theme: 'grid',
          headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 7.5 },
          bodyStyles: { fontSize: 7 },
          margin: { left: 14, right: 14 },
        });

        currentY = (doc as any).lastAutoTable.finalY + 10;
      }

      // 5. DEMAIS MÓDULOS ESPECÍFICOS QUANDO SELECIONADOS INDIVIDUALMENTE
      if (relatorioAlvo === 'ESCALAS') {
        autoTable(doc, {
          startY: currentY,
          head: [
            [
              'Funcionário',
              'Data',
              'Dia',
              'Entrada',
              'Saída',
              'Intervalo',
              'Turno',
              'Setor / Função',
              'Status',
              'Observações',
            ],
          ],
          body: escalasFiltradas.map((e) => [
            e.funcionarioNome,
            e.data,
            e.diaSemana || '',
            e.horarioInicio,
            e.horarioFim,
            e.intervalo || '1h',
            e.turno,
            `${e.setor || 'Pista'} / ${e.funcao || 'Frentista'}`,
            e.status,
            e.observacao || '—',
          ]),
          theme: 'grid',
          headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8 },
          bodyStyles: { fontSize: 7.5 },
          margin: { left: 14, right: 14 },
        });
        currentY = (doc as any).lastAutoTable.finalY + 10;
      } else if (relatorioAlvo === 'TANQUES') {
        autoTable(doc, {
          startY: currentY,
          head: [['Tanque', 'Combustível', 'Capacidade Nominal', 'Estoque Atual', 'Ocupação (%)']],
          body: tanques.map((t) => [
            t.codigo,
            t.produto,
            `${t.capacidadeNominal.toLocaleString('pt-BR')} L`,
            `${t.volumeAtual.toLocaleString('pt-BR')} L`,
            `${((t.volumeAtual / Math.max(1, t.capacidadeNominal)) * 100).toFixed(1)}%`,
          ]),
          theme: 'grid',
          headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8 },
          bodyStyles: { fontSize: 8 },
          margin: { left: 14, right: 14 },
        });
        currentY = (doc as any).lastAutoTable.finalY + 8;

        autoTable(doc, {
          startY: currentY,
          head: [['Bico', 'Bomba / Lado', 'Combustível', 'Status']],
          body: bicos.map((b) => [
            `Bico ${String(b.numero).padStart(2, '0')}`,
            `${b.bomba} (Lado ${b.lado})`,
            b.produto,
            b.status,
          ]),
          theme: 'grid',
          headStyles: { fillColor: [51, 65, 85], textColor: 255, fontSize: 8 },
          bodyStyles: { fontSize: 8 },
          margin: { left: 14, right: 14 },
        });
        currentY = (doc as any).lastAutoTable.finalY + 10;
      } else if (relatorioAlvo === 'FALTAS') {
        autoTable(doc, {
          startY: currentY,
          head: [['Data', 'Colaborador', 'Tipo', 'Valor (R$)', 'Motivo / Descrição', 'Status']],
          body: ocorrencias.map((o) => [
            o.data,
            o.funcionarioNome || 'Operador',
            o.tipo,
            formatarMoeda(o.valor),
            o.motivo || '—',
            o.status,
          ]),
          theme: 'grid',
          headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8 },
          bodyStyles: { fontSize: 8 },
          margin: { left: 14, right: 14 },
        });
        currentY = (doc as any).lastAutoTable.finalY + 10;
      } else if (relatorioAlvo === 'CONFORMIDADE') {
        autoTable(doc, {
          startY: currentY,
          head: [['Data', 'Categoria', 'Item Inspecionado', 'Responsável', 'Status']],
          body: conformidades.map((c) => [
            c.dataVerificacao,
            c.categoria,
            c.item,
            c.responsavel,
            c.status,
          ]),
          theme: 'grid',
          headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8 },
          bodyStyles: { fontSize: 8 },
          margin: { left: 14, right: 14 },
        });
        currentY = (doc as any).lastAutoTable.finalY + 10;
      } else if (relatorioAlvo === 'FUNCIONARIOS') {
        autoTable(doc, {
          startY: currentY,
          head: [['Nome', 'Matrícula', 'Cargo / Função', 'Turno Preferencial', 'Admissão', 'Status']],
          body: funcionarios.map((f) => [
            f.nome,
            f.matricula,
            `${f.cargo} (${f.funcao || 'Pista'})`,
            f.turnoPreferencial,
            f.dataAdmissao,
            f.status,
          ]),
          theme: 'grid',
          headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8 },
          bodyStyles: { fontSize: 8 },
          margin: { left: 14, right: 14 },
        });
        currentY = (doc as any).lastAutoTable.finalY + 10;
      }

      // Bloco de Assinaturas e Conferência no final do documento
      if (currentY > doc.internal.pageSize.getHeight() - 35) {
        doc.addPage();
        currentY = 30;
      } else {
        currentY += 12;
      }

      doc.setDrawColor(148, 163, 184);
      doc.line(20, currentY, 95, currentY);
      doc.line(pageWidth - 95, currentY, pageWidth - 20, currentY);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      doc.text('Responsável Operacional / Conferência de Caixa', 25, currentY + 5);
      doc.text('Gerência / Auditoria Administrativa', pageWidth - 88, currentY + 5);

      // Numeração de páginas no rodapé
      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(7.5);
        doc.setTextColor(148, 163, 184);
        doc.text(
          `MEU POSTO 2.0 • Relatório Oficial: Fechamento, Auditoria, Análise e Aferições • Página ${i} de ${totalPages}`,
          14,
          doc.internal.pageSize.getHeight() - 8
        );
      }

      const nomeArquivo =
        relatorioAlvo === 'BALANCO_CONSOLIDADO'
          ? `relatorio_geral_fechamento_auditoria_analise_afericoes_${dataInicio}_a_${dataFim}.pdf`
          : `relatorio_${relatorioAlvo.toLowerCase()}_${dataInicio}_a_${dataFim}.pdf`;

      doc.save(nomeArquivo);
    } finally {
      setGerandoPdf(false);
    }
  };

  const handleExportarCsv = () => {
    let csvContent = 'data:text/csv;charset=utf-8,';
    const linhas: string[][] = [];

    if (tipo === 'BALANCO_CONSOLIDADO' || tipo === 'FECHAMENTOS') {
      linhas.push(['=== BALANCO DE FECHAMENTOS DE CAIXA ===']);
      linhas.push([
        'ID',
        'Data',
        'Turno',
        'Operador',
        'Total_Bombas_Conferido',
        'Total_Recolhido_Informado',
        'Diferenca',
        'Status',
        'Pix',
        'Cartao',
        'Nota',
        'Deposito',
        'Pix_CNPJ',
        'Despesa',
        'Outros',
      ]);
      fechamentosFiltrados.forEach((f) => {
        linhas.push([
          f.id,
          f.data,
          f.turno,
          f.funcionarioNome || '',
          String(f.totalConferido),
          String(f.totalInformado),
          String(f.diferenca),
          f.tipoDiferenca,
          String(f.recolhimento?.pix ?? ''),
          String(f.recolhimento?.cartao ?? ''),
          String(f.recolhimento?.nota ?? ''),
          String(f.recolhimento?.deposito ?? ''),
          String(f.recolhimento?.pixCnpj ?? ''),
          String(f.recolhimento?.despesa ?? ''),
          String(f.recolhimento?.outros ?? ''),
        ]);
      });
    }

    if (tipo === 'BALANCO_CONSOLIDADO' || tipo === 'AFERICOES') {
      if (linhas.length > 0) linhas.push([]);
      linhas.push(['=== BALANCO DE AFERICOES DE BICOS ===']);
      linhas.push([
        'Data',
        'Hora',
        'Bico',
        'Produto',
        'Nominal_L',
        'Aferido_L',
        'Diferenca_ml',
        'Resultado',
        'Responsavel',
      ]);
      afericoesFiltradas.forEach((a) => {
        linhas.push([
          a.data,
          a.hora,
          String(a.bicoNumero || a.bicoId),
          a.produto,
          String(a.volumeNominal),
          String(a.volumeAferido),
          String(Math.round(a.diferenca * 1000)),
          a.resultado,
          a.responsavelNome || '',
        ]);
      });
    }

    if (tipo === 'BALANCO_CONSOLIDADO' || tipo === 'DENSIDADES' || tipo === 'ANALISES') {
      if (linhas.length > 0) linhas.push([]);
      linhas.push(['=== ANALISES FISICO-QUIMICAS & QUALIDADE ANP ===']);
      linhas.push([
        'Data',
        'Hora',
        'Combustivel',
        'Tipo_Ensaio',
        'Densidade_Lida',
        'Temperatura_C',
        'Densidade_20C',
        'Faixa_ANP',
        'Teor_Parametro',
        'Resultado_ANP',
      ]);
      analisesFiltradas.forEach((d) => {
        linhas.push([
          d.data,
          d.hora || '',
          d.produto || '',
          d.tipoTeste || 'DENSIDADE_D20',
          String(d.densidadeObservada ?? ''),
          String(d.temperatura ?? (d as any).temperaturaC ?? ''),
          String(d.densidadeCalculada20C ?? ''),
          `${d.densidadeReferenciaMin ?? ''} - ${d.densidadeReferenciaMax ?? ''}`,
          d.teorEtanolAnidro ? `${d.teorEtanolAnidro}% Etanol` : '',
          d.resultado || (d as any).status || 'CONFORME',
        ]);
      });
    }

    if (tipo === 'BALANCO_CONSOLIDADO' || tipo === 'AUDITORIA') {
      if (linhas.length > 0) linhas.push([]);
      linhas.push(['=== TRILHA DE AUDITORIA & REGISTROS DE SEGURANCA ===']);
      linhas.push(['Timestamp', 'Usuario', 'Modulo', 'Entidade', 'Acao']);
      auditoriaFiltrada.forEach((l) => {
        linhas.push([
          l.timestamp ? new Date(l.timestamp).toLocaleString('pt-BR') : '',
          l.usuarioNome || '',
          l.modulo || '',
          l.entidade || '',
          l.acao || '',
        ]);
      });
    }

    if (tipo === 'ESCALAS') {
      linhas.push([
        'Funcionario',
        'Data',
        'Dia_Semana',
        'Entrada',
        'Saida',
        'Intervalo',
        'Turno',
        'Setor',
        'Funcao',
        'Status',
        'Observacoes',
      ]);
      escalasFiltradas.forEach((e) => {
        linhas.push([
          e.funcionarioNome,
          e.data,
          e.diaSemana || '',
          e.horarioInicio,
          e.horarioFim,
          e.intervalo || '1h',
          e.turno,
          e.setor || 'Pista',
          e.funcao || 'Frentista',
          e.status,
          e.observacao || '',
        ]);
      });
    }

    const csvStr = linhas.map((e) => e.join(';')).join('\n');
    csvContent += encodeURI(csvStr);
    const link = document.createElement('a');
    link.setAttribute('href', csvContent);
    link.setAttribute('download', `relatorio_${tipo.toLowerCase()}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  /**
   * Impressão direta na impressora térmica de bobina 80mm
   */
  const handleImprimirTermico = () => {
    window.print();
  };

  /**
   * Gera PDF formatado em bobina contínua de 80mm (Cupom Simplificado)
   */
  const handleGerarPdfTermico80mm = () => {
    try {
      setGerandoPdf(true);
      const fontSize = tamanhoFonteTermica === 'CONDENSADA' ? 7 : 7.5;
      const lineHeight = fontSize * 0.48; // mm por linha
      const centro = 40; // centro de 80mm
      const margemEsq = 4;
      const margemDir = 76;

      interface LinhaCupom {
        texto: string;
        negrito?: boolean;
        alinhamento?: 'left' | 'center' | 'right';
      }

      const linhas: LinhaCupom[] = [];

      linhas.push({ texto: 'POSTO DE COMBUSTIVEIS 2.0', negrito: true, alinhamento: 'center' });
      linhas.push({ texto: 'SISTEMA DE GESTAO & CONTROLE', alinhamento: 'center' });
      linhas.push({ texto: 'CNPJ: 00.000.000/0001-99', alinhamento: 'center' });
      linhas.push({ texto: '----------------------------------------', alinhamento: 'center' });
      linhas.push({ texto: 'RELATORIO SIMPLIFICADO - TERMICA 80MM', negrito: true, alinhamento: 'center' });
      linhas.push({ texto: `Periodo: ${dataInicio} a ${dataFim}`, alinhamento: 'center' });
      linhas.push({ texto: `Emissao: ${new Date().toLocaleString('pt-BR')}`, alinhamento: 'center' });
      linhas.push({ texto: '========================================', alinhamento: 'center' });

      // Seção 1: Fechamento de Caixa
      if (filtroSecaoTermica === 'TODOS' || filtroSecaoTermica === 'CAIXA') {
        linhas.push({ texto: '>>> 1. FECHAMENTO DE CAIXA <<<', negrito: true });
        linhas.push({ texto: `Turnos no Periodo:    ${balancoConsolidado.totalFechamentos}` });
        linhas.push({ texto: `Total Bombas (Conf):  ${formatarMoeda(balancoConsolidado.totalConferido)}` });
        linhas.push({ texto: `Total Informado:      ${formatarMoeda(balancoConsolidado.totalInformado)}` });
        linhas.push({
          texto: `Diferenca Liquida:    ${formatarMoeda(balancoConsolidado.saldoDiferenca)} (${balancoConsolidado.saldoDiferenca < 0 ? 'FALTA' : balancoConsolidado.saldoDiferenca > 0 ? 'SOBRA' : 'EXATO'})`,
          negrito: true,
        });
        linhas.push({ texto: '--- Meios de Pagamento ---' });
        linhas.push({ texto: `PIX Pista:            ${formatarMoeda(balancoConsolidado.meiosPagamento.pix)}` });
        linhas.push({ texto: `Cartoes (Deb/Cred):   ${formatarMoeda(balancoConsolidado.meiosPagamento.cartao)}` });
        linhas.push({ texto: `Dinheiro/Deposito:    ${formatarMoeda(balancoConsolidado.meiosPagamento.deposito)}` });
        linhas.push({ texto: `Notas a Prazo:        ${formatarMoeda(balancoConsolidado.meiosPagamento.nota)}` });
        linhas.push({ texto: `PIX CNPJ:             ${formatarMoeda(balancoConsolidado.meiosPagamento.pixCnpj)}` });
        linhas.push({ texto: `Despesas / Vales:     ${formatarMoeda(balancoConsolidado.meiosPagamento.despesa)}` });
        linhas.push({ texto: `Outros:               ${formatarMoeda(balancoConsolidado.meiosPagamento.outros)}` });
        linhas.push({ texto: '----------------------------------------', alinhamento: 'center' });
      }

      // Seção 2: Auditoria de Aferições & Impacto 1.000 L
      if (filtroSecaoTermica === 'TODOS' || filtroSecaoTermica === 'AFERICOES') {
        linhas.push({ texto: '>>> 2. AUDITORIA DE AFERICOES (20L) <<<', negrito: true });
        linhas.push({ texto: `Total de Ensaios:     ${balancoConsolidado.totalAfericoes} testes` });
        linhas.push({ texto: `Volume Aferido:       ${balancoConsolidado.volumeTotalAferido.toFixed(3)} L` });
        linhas.push({
          texto: `Valor Total Afericao: ${formatarMoeda(balancoConsolidado.valorTotalAfericoesGeral)}`,
          negrito: true,
        });
        linhas.push({
          texto: `Desvio Medio 20L:     ${balancoConsolidado.desvioMedioMl > 0 ? '+' : ''}${balancoConsolidado.desvioMedioMl} ml`,
        });
        linhas.push({ texto: `Conformidade Inmetro: ${balancoConsolidado.taxaConformidade}%` });
        linhas.push({ texto: '--- IMPACTO EM 1.000 L ABASTECIDOS ---', negrito: true });
        linhas.push({
          texto: `Diferenca Projetada:  ${balancoConsolidado.impactoMedioGeralLitros1000L > 0 ? '+' : ''}${balancoConsolidado.impactoMedioGeralLitros1000L.toFixed(2)} L / 1000L`,
          negrito: true,
        });
        linhas.push({
          texto: `Impacto Financeiro:   ${balancoConsolidado.impactoMedioGeralFinanceiro1000L > 0 ? '+' : ''}${formatarMoeda(balancoConsolidado.impactoMedioGeralFinanceiro1000L)} / 1000L`,
          negrito: true,
        });

        if (balancoConsolidado.resumoPorCombustivel.length > 0) {
          linhas.push({ texto: '--- Impacto por Combustivel ---' });
          balancoConsolidado.resumoPorCombustivel.forEach((c) => {
            linhas.push({ texto: `* ${c.produto}:`, negrito: true });
            linhas.push({ texto: `  Testes: ${c.qtdTestes} | Vol: ${c.volumeAferidoTotal.toFixed(1)} L` });
            linhas.push({
              texto: `  Desv 20L: ${c.desvioMedioMl > 0 ? '+' : ''}${c.desvioMedioMl} ml`,
            });
            linhas.push({
              texto: `  Imp 1.000L: ${c.impactoLitrosPor1000L > 0 ? '+' : ''}${c.impactoLitrosPor1000L.toFixed(2)} L (${formatarMoeda(c.impactoFinanceiroPor1000L)})`,
            });
            linhas.push({ texto: `  Valor: ${formatarMoeda(c.valorTotalAfericao)}` });
          });
        }

        if (balancoConsolidado.resumoPorBico.length > 0) {
          linhas.push({ texto: '--- TODAS AS AFERICOES POR BICO ---', negrito: true });
          balancoConsolidado.resumoPorBico.forEach((b) => {
            linhas.push({
              texto: `>> BICO ${String(b.bicoNumero).padStart(2, '0')} - ${b.produto.toUpperCase()}`,
              negrito: true,
            });
            linhas.push({
              texto: `   Bomba: ${b.bombaNome}`,
            });
            linhas.push({
              texto: `   Total Testes: ${b.qtdTestes}x | Vol: ${b.volumeAferidoTotal.toFixed(1)} L`,
            });
            linhas.push({
              texto: `   Desv Medio: ${b.desvioMedioMl > 0 ? '+' : ''}${b.desvioMedioMl} ml | Imp 1kL: ${b.impactoLitrosPor1000L > 0 ? '+' : ''}${b.impactoLitrosPor1000L.toFixed(2)} L`,
            });
            linhas.push({
              texto: `   Preco: ${formatarMoeda(b.precoLitro)} | Valor Tot: ${formatarMoeda(b.valorTotalAfericao)}`,
              negrito: true,
            });
            linhas.push({
              texto: `   Status: ${b.statusGeral} (${b.conformes} conf / ${b.naoConformes} n.conf)`,
            });

            // Lista TODAS as aferições individuais deste bico
            if (b.listaAfericoes && b.listaAfericoes.length > 0) {
              linhas.push({ texto: `   Ensaios Registrados (${b.listaAfericoes.length}):` });
              b.listaAfericoes.forEach((af, idx) => {
                const sinal = af.desvioMl > 0 ? '+' : '';
                linhas.push({
                  texto: `   #${idx + 1} ${af.data} ${af.hora || ''} | ${af.volumeAferido.toFixed(3)}L (${sinal}${af.desvioMl}ml)`,
                });
                const respInfo = af.responsavelNome ? `Resp: ${af.responsavelNome.slice(0, 10)}` : '';
                linhas.push({
                  texto: `      ${af.resultado === 'CONFORME' ? '[OK]' : '[FORA]'} ${formatarMoeda(af.valorTeste)}${respInfo ? ` | ${respInfo}` : ''}`,
                });
              });
            }
            linhas.push({ texto: ' . . . . . . . . . . . . . . . . . . . .' });
          });
        }
        linhas.push({ texto: '----------------------------------------', alinhamento: 'center' });
      }

      // Seção 3: Qualidade ANP
      if (filtroSecaoTermica === 'TODOS' || filtroSecaoTermica === 'QUALIDADE') {
        linhas.push({ texto: '>>> 3. ANÁLISES & QUALIDADE ANP <<<', negrito: true });
        linhas.push({ texto: `Total de Analises:    ${balancoConsolidado.totalAnalises}` });
        linhas.push({
          texto: `Conformes ANP:        ${balancoConsolidado.analisesConformes} (${balancoConsolidado.taxaConformidadeAnalises}%)`,
        });
        linhas.push({ texto: `Nao Conformes:        ${balancoConsolidado.analisesNaoConformes}` });
        linhas.push({ texto: '----------------------------------------', alinhamento: 'center' });
      }

      // Rodapé
      linhas.push({ texto: 'CONFERENCIA OPERACIONAL', alinhamento: 'center' });
      linhas.push({ texto: ' ' });
      linhas.push({ texto: '________________________________________', alinhamento: 'center' });
      linhas.push({ texto: 'Operador / Responsavel de Caixa', alinhamento: 'center' });
      linhas.push({ texto: ' ' });
      linhas.push({ texto: '________________________________________', alinhamento: 'center' });
      linhas.push({ texto: 'Gerencia / Fiscal de Pista', alinhamento: 'center' });
      linhas.push({ texto: ' ' });
      linhas.push({ texto: '*** FIM DO COMPROVANTE TERMICO 80MM ***', alinhamento: 'center' });

      const alturaTotalMm = Math.max(130, Math.ceil(linhas.length * lineHeight + 18));

      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [80, alturaTotalMm],
      });

      doc.setFont('courier', 'normal');
      doc.setFontSize(fontSize);
      doc.setTextColor(0, 0, 0);

      let curY = 6;
      linhas.forEach((item) => {
        doc.setFont('courier', item.negrito ? 'bold' : 'normal');
        if (item.alinhamento === 'center') {
          doc.text(item.texto, centro, curY, { align: 'center' });
        } else if (item.alinhamento === 'right') {
          doc.text(item.texto, margemDir, curY, { align: 'right' });
        } else {
          doc.text(item.texto, margemEsq, curY);
        }
        curY += lineHeight;
      });

      doc.save(`cupom_termico_80mm_${dataInicio}_a_${dataFim}.pdf`);
    } finally {
      setGerandoPdf(false);
    }
  };

  /**
   * Renderizador do Modo Simplificado para Impressora Térmica 80mm
   */
  const renderModoTermico80mm = () => {
    return (
      <div className="space-y-6 print:m-0 print:p-0">
        <style>{`
          @media print {
            @page {
              size: 80mm auto;
              margin: 2mm 2mm 4mm 2mm;
            }
            body {
              background: #fff !important;
              color: #000 !important;
            }
            .nao-imprimir-termica {
              display: none !important;
            }
            .cupom-termico-container {
              width: 76mm !important;
              max-width: 76mm !important;
              margin: 0 !important;
              padding: 0 !important;
              box-shadow: none !important;
              border: none !important;
              background: transparent !important;
            }
          }
        `}</style>

        {/* Barra Superior de Controles do Modo Térmico */}
        <div className="nao-imprimir-termica bg-white p-4 sm:p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setModoTermico80mm(false)}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs transition cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              Voltar ao Modo Completo
            </button>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                <Receipt className="w-5 h-5 text-amber-600" />
                Modo Térmico Simplificado (80mm x 30mm)
              </h2>
              <p className="text-xs text-slate-500">
                Otimizado para bobinas térmicas não-fiscais de 80mm (Epson, Bematech, Elgin, Daruma e POS portáteis).
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Seletor de Seção do Cupom */}
            <div className="flex items-center bg-slate-100 p-1 rounded-lg text-xs font-semibold">
              {(
                [
                  { id: 'TODOS', label: 'Completo' },
                  { id: 'CAIXA', label: '1. Caixa' },
                  { id: 'AFERICOES', label: '2. Aferições & 1.000L' },
                  { id: 'QUALIDADE', label: '3. Qualidade' },
                ] as const
              ).map((sec) => (
                <button
                  key={sec.id}
                  onClick={() => setFiltroSecaoTermica(sec.id)}
                  className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                    filtroSecaoTermica === sec.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {sec.label}
                </button>
              ))}
            </div>

            {/* Alternar densidade de fonte */}
            <div className="flex items-center bg-slate-100 p-1 rounded-lg text-xs font-semibold">
              <button
                onClick={() => setTamanhoFonteTermica('NORMAL')}
                className={`px-2 py-1 rounded-md transition cursor-pointer ${
                  tamanhoFonteTermica === 'NORMAL'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="38 a 40 colunas padrão"
              >
                Fonte Normal
              </button>
              <button
                onClick={() => setTamanhoFonteTermica('CONDENSADA')}
                className={`px-2 py-1 rounded-md transition cursor-pointer ${
                  tamanhoFonteTermica === 'CONDENSADA'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="44 a 48 colunas condensadas"
              >
                Condensada
              </button>
            </div>

            <button
              onClick={handleImprimirTermico}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs transition shadow-sm cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              Imprimir na Térmica (80mm)
            </button>

            <button
              onClick={handleGerarPdfTermico80mm}
              disabled={gerandoPdf}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-amber-300 font-bold rounded-lg text-xs transition shadow-sm disabled:opacity-50 cursor-pointer"
            >
              <FileDown className="w-4 h-4 text-amber-400" />
              {gerandoPdf ? 'Gerando...' : 'Baixar PDF Térmico 80mm'}
            </button>
          </div>
        </div>

        {/* Pré-visualização Fidedigna do Cupom de Bobina Térmica (80mm) */}
        <div className="flex justify-center pb-12 print:p-0">
          <div
            id="cupom-termico-imprimir"
            className={`cupom-termico-container w-full max-w-[340px] bg-white p-5 sm:p-6 shadow-2xl border border-slate-300 rounded-sm font-mono text-slate-900 leading-snug tracking-tight ${
              tamanhoFonteTermica === 'CONDENSADA' ? 'text-[10px]' : 'text-[11px]'
            }`}
          >
            {/* Marca de picote / serrilha no topo */}
            <div className="text-center text-slate-300 text-[9px] mb-2 select-none print:hidden">
              - - - - - - - - CORTE AQUI (80MM) - - - - - - - -
            </div>

            {/* Cabeçalho do Posto */}
            <div className="text-center border-b border-dashed border-slate-400 pb-3 mb-3">
              <div className="text-sm font-extrabold uppercase tracking-wide">POSTO DE COMBUSTÍVEIS 2.0</div>
              <div className="text-[10px] text-slate-600 mt-0.5">SISTEMA DE GESTÃO & METROLOGIA</div>
              <div className="text-[10px] text-slate-500">CNPJ: 00.000.000/0001-99 • INSC: 123.456.789</div>
              <div className="text-[10px] text-slate-500">AV. PRINCIPAL, 1000 - PISTA CENTRAL</div>
              <div className="border-t border-slate-300 my-2 pt-1 font-bold text-[10px] uppercase text-slate-800">
                RELATÓRIO SIMPLIFICADO TÉRMICO
              </div>
              <div className="flex justify-between text-[10px] text-slate-600 mt-1">
                <span>Período:</span>
                <span className="font-bold">{dataInicio} a {dataFim}</span>
              </div>
              <div className="flex justify-between text-[10px] text-slate-600">
                <span>Emissão:</span>
                <span>{new Date().toLocaleString('pt-BR')}</span>
              </div>
            </div>

            {/* SEÇÃO 1: FECHAMENTO DE CAIXA */}
            {(filtroSecaoTermica === 'TODOS' || filtroSecaoTermica === 'CAIXA') && (
              <div className="border-b border-dashed border-slate-400 pb-3 mb-3 space-y-1">
                <div className="font-extrabold text-[11px] uppercase bg-slate-100 px-1 py-0.5 text-slate-900 flex justify-between">
                  <span>1. FECHAMENTO DE CAIXA</span>
                  <span>{balancoConsolidado.totalFechamentos} turnos</span>
                </div>
                <div className="flex justify-between pt-1">
                  <span>Total Bombas (Conf):</span>
                  <span className="font-bold">{formatarMoeda(balancoConsolidado.totalConferido)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Total Recolhido:</span>
                  <span className="font-bold">{formatarMoeda(balancoConsolidado.totalInformado)}</span>
                </div>
                <div className="flex justify-between font-bold border-t border-dotted border-slate-300 pt-1 text-[11px]">
                  <span>Diferença Líquida:</span>
                  <span
                    className={
                      balancoConsolidado.saldoDiferenca < 0
                        ? 'text-red-700'
                        : balancoConsolidado.saldoDiferenca > 0
                        ? 'text-emerald-700'
                        : 'text-slate-800'
                    }
                  >
                    {formatarMoeda(balancoConsolidado.saldoDiferenca)} ({balancoConsolidado.saldoDiferenca < 0 ? 'FALTA' : balancoConsolidado.saldoDiferenca > 0 ? 'SOBRA' : 'ZERADO'})
                  </span>
                </div>

                <div className="pt-1.5 text-[10px] font-bold text-slate-600 uppercase border-t border-slate-200 mt-2">
                  Meios de Pagamento:
                </div>
                <div className="flex justify-between text-[10px]">
                  <span>• PIX Pista:</span>
                  <span>{formatarMoeda(balancoConsolidado.meiosPagamento.pix)}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span>• Cartões (Déb/Créd):</span>
                  <span>{formatarMoeda(balancoConsolidado.meiosPagamento.cartao)}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span>• Dinheiro / Depósito:</span>
                  <span>{formatarMoeda(balancoConsolidado.meiosPagamento.deposito)}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span>• Notas a Prazo:</span>
                  <span>{formatarMoeda(balancoConsolidado.meiosPagamento.nota)}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span>• PIX CNPJ:</span>
                  <span>{formatarMoeda(balancoConsolidado.meiosPagamento.pixCnpj)}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span>• Despesas / Vales:</span>
                  <span>{formatarMoeda(balancoConsolidado.meiosPagamento.despesa)}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span>• Outros:</span>
                  <span>{formatarMoeda(balancoConsolidado.meiosPagamento.outros)}</span>
                </div>
              </div>
            )}

            {/* SEÇÃO 2: AUDITORIA DE AFERIÇÕES & IMPACTO EM 1.000 L */}
            {(filtroSecaoTermica === 'TODOS' || filtroSecaoTermica === 'AFERICOES') && (
              <div className="border-b border-dashed border-slate-400 pb-3 mb-3 space-y-1.5">
                <div className="font-extrabold text-[11px] uppercase bg-slate-100 px-1 py-0.5 text-slate-900 flex justify-between">
                  <span>2. AUDITORIA DE AFERIÇÕES</span>
                  <span>{balancoConsolidado.totalAfericoes} testes</span>
                </div>

                <div className="flex justify-between">
                  <span>Volume Total Aferido:</span>
                  <span className="font-bold">{balancoConsolidado.volumeTotalAferido.toFixed(3)} L</span>
                </div>
                <div className="flex justify-between">
                  <span>Valor Total da Aferição:</span>
                  <span className="font-bold text-emerald-800">
                    {formatarMoeda(balancoConsolidado.valorTotalAfericoesGeral)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Desvio Médio em 20L:</span>
                  <span className="font-bold">
                    {balancoConsolidado.desvioMedioMl > 0 ? '+' : ''}
                    {balancoConsolidado.desvioMedioMl} ml
                  </span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span>Conformidade Inmetro:</span>
                  <span>{balancoConsolidado.taxaConformidade}% (±100ml)</span>
                </div>

                {/* Bloco de Destaque: Impacto em 1.000 L */}
                <div className="border-t border-b border-slate-300 py-1.5 my-1.5 bg-slate-50 px-1 space-y-1">
                  <div className="text-[10px] font-bold uppercase text-blue-900 text-center">
                    CÁLCULO DE IMPACTO EM 1.000 L ABASTECIDOS
                  </div>
                  <div className="flex justify-between font-bold text-[11px]">
                    <span>Diferença Projetada:</span>
                    <span
                      className={
                        balancoConsolidado.impactoMedioGeralLitros1000L > 0
                          ? 'text-amber-800'
                          : balancoConsolidado.impactoMedioGeralLitros1000L < 0
                          ? 'text-blue-800'
                          : 'text-slate-800'
                      }
                    >
                      {balancoConsolidado.impactoMedioGeralLitros1000L > 0 ? '+' : ''}
                      {balancoConsolidado.impactoMedioGeralLitros1000L.toFixed(2)} L
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span>Impacto Financeiro / 1.000L:</span>
                    <span className="font-bold">
                      {balancoConsolidado.impactoMedioGeralFinanceiro1000L > 0 ? '+' : ''}
                      {formatarMoeda(balancoConsolidado.impactoMedioGeralFinanceiro1000L)}
                    </span>
                  </div>
                </div>

                {/* Resumo por Tipo de Combustível */}
                {balancoConsolidado.resumoPorCombustivel.length > 0 && (
                  <div className="space-y-1 pt-1">
                    <div className="text-[10px] font-bold uppercase text-slate-600 border-b border-dotted border-slate-300 pb-0.5">
                      Por Tipo de Combustível:
                    </div>
                    {balancoConsolidado.resumoPorCombustivel.map((c) => (
                      <div key={c.produto} className="text-[10px] border-b border-slate-100 pb-1">
                        <div className="flex justify-between font-bold">
                          <span>{c.produto}:</span>
                          <span>{formatarMoeda(c.valorTotalAfericao)}</span>
                        </div>
                        <div className="flex justify-between text-slate-600 text-[9.5px]">
                          <span>
                            {c.qtdTestes}x ({c.volumeAferidoTotal.toFixed(1)}L) • Desv: {c.desvioMedioMl > 0 ? '+' : ''}{c.desvioMedioMl}ml
                          </span>
                          <span className="font-semibold text-blue-900">
                            Imp: {c.impactoLitrosPor1000L > 0 ? '+' : ''}{c.impactoLitrosPor1000L.toFixed(2)}L
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Detalhamento de TODAS as Aferições por Bico */}
                {balancoConsolidado.resumoPorBico.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <div className="text-[10px] font-bold uppercase text-slate-800 border-b border-dotted border-slate-400 pb-0.5 flex justify-between">
                      <span>TODAS AS AFERIÇÕES POR BICO</span>
                      <span>{balancoConsolidado.totalAfericoes} ensaios</span>
                    </div>

                    {balancoConsolidado.resumoPorBico.map((b) => (
                      <div key={b.bicoNumero} className="border border-slate-300 rounded-xs p-1.5 bg-slate-50/60 space-y-1">
                        <div className="flex justify-between font-bold text-[10.5px] border-b border-slate-200 pb-0.5 text-slate-900">
                          <span>BICO {String(b.bicoNumero).padStart(2, '0')} — {b.produto}</span>
                          <span>{formatarMoeda(b.valorTotalAfericao)}</span>
                        </div>
                        <div className="text-[9.5px] text-slate-600 space-y-0.5">
                          <div className="flex justify-between">
                            
                            <span className="font-semibold text-slate-800">{b.qtdTestes} teste(s) ({b.volumeAferidoTotal.toFixed(1)}L)</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Desvio Médio: {b.desvioMedioMl > 0 ? '+' : ''}{b.desvioMedioMl} ml</span>
                            <span className="font-bold text-blue-900">
                              Imp 1kL: {b.impactoLitrosPor1000L > 0 ? '+' : ''}{b.impactoLitrosPor1000L.toFixed(2)} L
                            </span>
                          </div>
                          <div className="flex justify-between text-[9px] text-slate-500">
                            <span>Preço: {formatarMoeda(b.precoLitro)}/L</span>
                            <span className={b.statusGeral === 'CONFORME' ? 'text-emerald-700 font-bold' : 'text-red-700 font-bold'}>
                              {b.statusGeral} ({b.conformes} conf / {b.naoConformes} n.conf)
                            </span>
                          </div>
                        </div>

                        {/* Listagem de CADA UMA das aferições do bico */}
                        {b.listaAfericoes && b.listaAfericoes.length > 0 && (
                          <div className="mt-1 pt-1 border-t border-dotted border-slate-300 space-y-1">
                            <div className="text-[9px] font-bold uppercase text-slate-500">
                              Ensaios deste Bico ({b.listaAfericoes.length}):
                            </div>
                            {b.listaAfericoes.map((af, idx) => (
                              <div key={af.id || idx} className="text-[9px] bg-white p-1 rounded-xs border border-slate-200">
                                <div className="flex justify-between font-semibold">
                                  <span>#{idx + 1} {af.data} {af.hora || ''}</span>
                                  <span className={af.desvioMl > 0 ? 'text-amber-700' : af.desvioMl < 0 ? 'text-blue-700' : 'text-slate-700'}>
                                    {af.volumeAferido.toFixed(3)}L ({af.desvioMl > 0 ? '+' : ''}{af.desvioMl}ml)
                                  </span>
                                </div>
                                <div className="flex justify-between text-slate-500 text-[8.5px] mt-0.5">
                                  <span className={af.resultado === 'CONFORME' ? 'text-emerald-700 font-bold' : 'text-red-700 font-bold'}>
                                    {af.resultado === 'CONFORME' ? '✓ Conforme' : '✗ Fora Tol.'} • {formatarMoeda(af.valorTeste)}
                                  </span>
                                  <span>
                                    {af.responsavelNome ? `Resp: ${af.responsavelNome.slice(0, 10)}` : ''}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* SEÇÃO 3: QUALIDADE & DENSIDADE ANP */}
            {(filtroSecaoTermica === 'TODOS' || filtroSecaoTermica === 'QUALIDADE') && (
              <div className="border-b border-dashed border-slate-400 pb-3 mb-3 space-y-1">
                <div className="font-extrabold text-[11px] uppercase bg-slate-100 px-1 py-0.5 text-slate-900 flex justify-between">
                  <span>3. QUALIDADE & DENSIDADE ANP</span>
                  <span>{balancoConsolidado.totalAnalises} ensaios</span>
                </div>
                <div className="flex justify-between pt-1">
                  <span>Conformes ANP:</span>
                  <span className="font-bold text-emerald-800">
                    {balancoConsolidado.analisesConformes} ({balancoConsolidado.taxaConformidadeAnalises}%)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Não Conformes:</span>
                  <span className={balancoConsolidado.analisesNaoConformes > 0 ? 'text-red-700 font-bold' : 'text-slate-600'}>
                    {balancoConsolidado.analisesNaoConformes}
                  </span>
                </div>
              </div>
            )}

            {/* ASSINATURAS E CONFERÊNCIA */}
            <div className="pt-3 text-center space-y-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-700">
                TERMO DE CONFERÊNCIA OPERACIONAL
              </div>
              <div>
                <div className="border-b border-slate-400 w-4/5 mx-auto"></div>
                <div className="text-[9px] text-slate-600 mt-1 uppercase">Operador / Responsável pelo Caixa</div>
              </div>
              <div>
                <div className="border-b border-slate-400 w-4/5 mx-auto"></div>
                <div className="text-[9px] text-slate-600 mt-1 uppercase">Gerência / Fiscalização de Pista</div>
              </div>

              <div className="border-t border-slate-300 pt-3 text-[9px] text-slate-500">
                MEU POSTO 2.0 • COMPROVANTE TÉRMICO 80MM<br />
                Documento de Auditoria e Controle Interno
              </div>

              <div className="text-[8px] text-slate-400 select-none print:hidden">
                - - - - - - - - FIM DA BOBINA (80MM) - - - - - - - -
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  /**
   * Renderização do Painel Completo de Aferições Metrológicas:
   * - Informações detalhadas de bicos aferidos
   * - Valor total da aferição por bico e por tipo de combustível
   * - Cálculo total de impacto de litros por cada tipo de combustível em 1.000 L de abastecimento
   */
  const renderPainelAfericoesCompleto = () => {
    return (
      <div className="space-y-6 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 pb-2">
          <div>
            <h4 className="text-sm font-bold text-slate-800 uppercase flex items-center gap-2">
              <Gauge className="w-4 h-4 text-emerald-600" />
              Seção de Auditoria de Aferições & Impacto Metrológico (Coleção 'afericoes')
            </h4>
            <p className="text-xs text-slate-500 mt-0.5">
              Auditoria de precisão volumétrica, cálculo automático de impacto financeiro e litragem por cada 1.000 L abastecidos, valor total por bico e combustível.
            </p>
          </div>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg text-[11px] font-bold">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            {balancoConsolidado.taxaConformidade}% Conforme Inmetro
          </span>
        </div>

        {/* 4 Cards de Indicadores Principais */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <div className="text-[11px] font-bold uppercase text-slate-500">
              Total de Aferições
            </div>
            <div className="text-xl font-bold text-slate-900 font-mono mt-1">
              {balancoConsolidado.totalAfericoes} testes
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Volume Total: {balancoConsolidado.volumeTotalAferido.toFixed(3)} L
            </div>
          </div>

          <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-200">
            <div className="text-[11px] font-bold uppercase text-emerald-800 flex items-center justify-between">
              <span>Valor Total das Aferições</span>
              <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
            </div>
            <div className="text-xl font-bold text-emerald-800 font-mono mt-1">
              {formatarMoeda(balancoConsolidado.valorTotalAfericoesGeral)}
            </div>
            <div className="text-[11px] text-emerald-700 mt-1">
              Combustível aferido a preço de bomba
            </div>
          </div>

          <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-200">
            <div className="text-[11px] font-bold uppercase text-blue-800">
              Desvio Volumétrico Médio (20L)
            </div>
            <div className="text-xl font-bold text-blue-950 font-mono mt-1">
              {balancoConsolidado.desvioMedioMl > 0 ? '+' : ''}
              {balancoConsolidado.desvioMedioMl} ml
            </div>
            <div className="text-[11px] text-blue-700 mt-1">
              Média por aferidor padrão de 20,000 L
            </div>
          </div>

          <div
            className={`p-4 rounded-xl border ${
              balancoConsolidado.afericoesNaoConformes > 0
                ? 'bg-amber-50/70 border-amber-200'
                : 'bg-emerald-50/70 border-emerald-200'
            }`}
          >
            <div className="text-[11px] font-bold uppercase text-slate-700 flex items-center justify-between">
              <span>Impacto Geral / 1.000 L</span>
              <Gauge className="w-3.5 h-3.5 text-slate-600" />
            </div>
            <div
              className={`text-xl font-bold font-mono mt-1 ${
                balancoConsolidado.impactoMedioGeralLitros1000L > 0
                  ? 'text-amber-800'
                  : balancoConsolidado.impactoMedioGeralLitros1000L < 0
                  ? 'text-blue-800'
                  : 'text-emerald-800'
              }`}
            >
              {balancoConsolidado.impactoMedioGeralLitros1000L > 0 ? '+' : ''}
              {balancoConsolidado.impactoMedioGeralLitros1000L.toFixed(2)} L
            </div>
            <div className="text-[11px] text-slate-600 mt-1">
              Equiv: {formatarMoeda(balancoConsolidado.impactoMedioGeralFinanceiro1000L)} / 1.000 L vendidos
            </div>
          </div>
        </div>

        {/* Banner de Auditoria de Aferições — Metodologia e Impacto Calculado */}
        <div className="bg-gradient-to-r from-emerald-50 via-teal-50 to-blue-50 border border-emerald-200 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-emerald-600 text-white rounded-lg shrink-0 mt-0.5 shadow-xs">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h5 className="text-xs font-bold uppercase text-emerald-950 tracking-wider flex items-center gap-2">
                Auditoria de Aferições — Análise Metrológica e Financeira
                <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-200/80 text-emerald-900 font-mono font-bold">
                  {balancoConsolidado.totalAfericoes} ensaios na coleção 'afericoes'
                </span>
              </h5>
              <p className="text-xs text-emerald-900/90 mt-1 leading-relaxed">
                Cada ensaio volumétrico de <strong>20 Litros</strong> padrão Inmetro é multiplicado pelo fator de escala metrológica (<strong>50x</strong>) para calcular automaticamente a <strong>diferença em litros para cada 1.000 litros abastecidos</strong>. Os impactos financeiros são calculados com base nos preços vigentes praticados em cada bico aferido.
              </p>
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-2 bg-white/90 backdrop-blur-xs px-3.5 py-2 rounded-lg border border-emerald-200 text-xs font-mono font-semibold text-emerald-900 shadow-xs">
            <span>Diferença Média / 1.000 L:</span>
            <span
              className={`font-bold ${
                balancoConsolidado.impactoMedioGeralLitros1000L > 0
                  ? 'text-amber-700'
                  : balancoConsolidado.impactoMedioGeralLitros1000L < 0
                  ? 'text-blue-700'
                  : 'text-emerald-700'
              }`}
            >
              {balancoConsolidado.impactoMedioGeralLitros1000L > 0 ? '+' : ''}
              {balancoConsolidado.impactoMedioGeralLitros1000L.toFixed(2)} L
            </span>
          </div>
        </div>

        {/* BARRA DE CONTROLE: AGRUPAMENTO & FILTRAGEM DO RELATÓRIO DE AFERIÇÕES */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3.5 print:hidden">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            {/* Seletor de Modo de Agrupamento */}
            <div className="flex flex-wrap items-center gap-1.5 bg-white p-1 rounded-lg border border-slate-200 shadow-2xs">
              <span className="text-[11px] font-bold uppercase text-slate-500 px-2 flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-slate-400" />
                Agrupar Relatório por:
              </span>
              <button
                type="button"
                onClick={() => setAgrupamentoAfericoes('COMBUSTIVEL')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition cursor-pointer ${
                  agrupamentoAfericoes === 'COMBUSTIVEL'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Fuel className="w-3.5 h-3.5" />
                Tipo de Combustível
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                    agrupamentoAfericoes === 'COMBUSTIVEL'
                      ? 'bg-blue-700 text-white'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {balancoConsolidado.resumoPorCombustivel.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setAgrupamentoAfericoes('CRONOLOGICO')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition cursor-pointer ${
                  agrupamentoAfericoes === 'CRONOLOGICO'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                Lista Cronológica
              </button>
              <button
                type="button"
                onClick={() => setAgrupamentoAfericoes('BICO')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition cursor-pointer ${
                  agrupamentoAfericoes === 'BICO'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Gauge className="w-3.5 h-3.5" />
                Por Bico
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                    agrupamentoAfericoes === 'BICO'
                      ? 'bg-blue-700 text-white'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {balancoConsolidado.resumoPorBico.length}
                </span>
              </button>
            </div>

            {/* Filtros de Status Inmetro e Bico */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Filtro Status Inmetro */}
              <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-200 text-xs">
                <span className="text-[10px] font-bold uppercase text-slate-400 px-1.5">Status:</span>
                <button
                  type="button"
                  onClick={() => setFiltroStatusAfericao('TODOS')}
                  className={`px-2 py-1 rounded text-xs font-semibold cursor-pointer ${
                    filtroStatusAfericao === 'TODOS'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Todos
                </button>
                <button
                  type="button"
                  onClick={() => setFiltroStatusAfericao('CONFORME')}
                  className={`px-2 py-1 rounded text-xs font-semibold cursor-pointer ${
                    filtroStatusAfericao === 'CONFORME'
                      ? 'bg-emerald-600 text-white'
                      : 'text-emerald-700 hover:bg-emerald-50'
                  }`}
                >
                  ✓ Conformes
                </button>
                <button
                  type="button"
                  onClick={() => setFiltroStatusAfericao('FORA_LIMITE')}
                  className={`px-2 py-1 rounded text-xs font-semibold cursor-pointer ${
                    filtroStatusAfericao === 'FORA_LIMITE'
                      ? 'bg-red-600 text-white'
                      : 'text-red-700 hover:bg-red-50'
                  }`}
                >
                  ⚠ Fora Faixa
                </button>
              </div>

              {/* Filtro por Bico */}
              <select
                value={filtroBicoAfericao}
                onChange={(e) => setFiltroBicoAfericao(e.target.value)}
                className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer"
              >
                <option value="TODOS">⛽ Todos os Bicos</option>
                {Array.from(new Set(bicos.map((b) => Number(b.numero))))
                  .sort((a, b) => Number(a) - Number(b))
                  .map((num) => (
                    <option key={num} value={String(num)}>
                      Bico {String(num).padStart(2, '0')}
                    </option>
                  ))}
              </select>

              {/* Botão Limpar Filtros */}
              {(filtroCombustivel !== 'TODOS' ||
                filtroStatusAfericao !== 'TODOS' ||
                filtroBicoAfericao !== 'TODOS' ||
                busca.trim() !== '') && (
                <button
                  type="button"
                  onClick={() => {
                    setFiltroCombustivel('TODOS');
                    setFiltroStatusAfericao('TODOS');
                    setFiltroBicoAfericao('TODOS');
                    setBusca('');
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-600 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition cursor-pointer"
                  title="Limpar todos os filtros da seção de aferições"
                >
                  <RotateCcw className="w-3 h-3" />
                  Limpar Filtros
                </button>
              )}
            </div>
          </div>

          {/* Chips rápidos de Combustível */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-0.5">
            <span className="text-[11px] font-bold uppercase text-slate-500 shrink-0 flex items-center gap-1">
              <Filter className="w-3 h-3 text-slate-400" />
              Filtrar Combustível:
            </span>
            <button
              type="button"
              onClick={() => setFiltroCombustivel('TODOS')}
              className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold transition cursor-pointer ${
                filtroCombustivel === 'TODOS'
                  ? 'bg-blue-600 text-white font-bold shadow-2xs'
                  : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-200'
              }`}
            >
              ⛽ Todos ({afericoes.length})
            </button>
            {listaCombustiveisDisponiveis.map((prod) => {
              const qtd = afericoes.filter((a) => a.produto === prod).length;
              const isSelected = filtroCombustivel === prod;
              return (
                <button
                  key={prod}
                  type="button"
                  onClick={() => setFiltroCombustivel(isSelected ? 'TODOS' : prod)}
                  className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer ${
                    isSelected
                      ? 'bg-blue-600 text-white font-bold shadow-2xs'
                      : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-200'
                  }`}
                >
                  <span>{prod}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                      isSelected ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {qtd}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* PAINEL 1: CÁLCULO TOTAL DE IMPACTO POR TIPO DE COMBUSTÍVEL EM 1.000 L DE ABASTECIMENTO */}
        <div className="space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <h5 className="text-xs font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
              <FlaskConical className="w-3.5 h-3.5 text-blue-600" />
              Cálculo Total de Impacto de Litros por cada Tipo de Combustível em 1.000 L de Abastecimento
            </h5>
            <span className="text-[11px] font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
              Fórmula: (Desvio 20L ÷ 20L) × 1.000L = Desvio (ml) × 50 ÷ 1.000
            </span>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <ReportTable className="w-full text-xs text-left">
              <thead className="bg-slate-100 border-b border-slate-200 font-bold text-slate-700 uppercase">
                <tr>
                  <th className="py-2.5 px-3">Tipo de Combustível</th>
                  <th className="py-2.5 px-3">Bicos Aferidos</th>
                  <th className="py-2.5 px-3">Qtd. Testes (20L)</th>
                  <th className="py-2.5 px-3">Volume Total</th>
                  <th className="py-2.5 px-3">Preço Médio (R$/L)</th>
                  <th className="py-2.5 px-3">Valor Total da Aferição</th>
                  <th className="py-2.5 px-3">Desvio Médio (20L)</th>
                  <th className="py-2.5 px-3 bg-blue-50/70 text-blue-950 font-extrabold">
                    Impacto Litros / 1.000 L
                  </th>
                  <th className="py-2.5 px-3 bg-blue-50/70 text-blue-950 font-extrabold">
                    Impacto R$ / 1.000 L
                  </th>
                  <th className="py-2.5 px-3">Conformidade Inmetro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {balancoConsolidado.resumoPorCombustivel.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-6 text-center text-slate-400">
                      Nenhum ensaio metrológico encontrado com os filtros atuais.
                    </td>
                  </tr>
                ) : (
                  balancoConsolidado.resumoPorCombustivel.map((c: any) => (
                    <tr key={c.produto} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-semibold text-slate-900">{c.produto}</td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600">
                        {c.bicosNumeros.map((n: number) => `Bico ${String(n).padStart(2, '0')}`).join(', ')}
                      </td>
                      <td className="py-2.5 px-3 font-mono">{c.qtdTestes} teste(s)</td>
                      <td className="py-2.5 px-3 font-mono font-semibold">{c.volumeAferidoTotal.toFixed(3)} L</td>
                      <td className="py-2.5 px-3 font-mono">{formatarMoeda(c.precoMedioLitro)}</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-emerald-700">
                        {formatarMoeda(c.valorTotalAfericao)}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold">
                        <span className={c.desvioMedioMl > 0 ? 'text-amber-700' : c.desvioMedioMl < 0 ? 'text-blue-700' : 'text-slate-700'}>
                          {c.desvioMedioMl > 0 ? '+' : ''}{c.desvioMedioMl} ml
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold bg-blue-50/40">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${
                            c.impactoLitrosPor1000L > 0
                              ? 'bg-amber-100 text-amber-900'
                              : c.impactoLitrosPor1000L < 0
                              ? 'bg-blue-100 text-blue-900'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {c.impactoLitrosPor1000L > 0 ? '+' : ''}
                          {c.impactoLitrosPor1000L.toFixed(2)} L
                          <span className="ml-1 text-[9px] font-normal opacity-75">
                            ({c.impactoLitrosPor1000L > 0 ? 'Sobra entregue' : c.impactoLitrosPor1000L < 0 ? 'Retenção' : 'Exato'})
                          </span>
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono font-semibold bg-blue-50/40 text-slate-800">
                        {c.impactoFinanceiroPor1000L > 0 ? '+' : ''}
                        {formatarMoeda(c.impactoFinanceiroPor1000L)} / 1.000L
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            c.naoConformes === 0
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {c.conformes} de {c.qtdTestes} ({c.taxaConformidade}%)
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {balancoConsolidado.resumoPorCombustivel.length > 0 && (
                <tfoot className="bg-slate-50 border-t border-slate-200 font-bold text-slate-900">
                  <tr>
                    <td className="py-2.5 px-3 uppercase text-[11px]">Total Consolidado</td>
                    <td className="py-2.5 px-3 font-mono text-[11px]">
                      {new Set(afericoesFiltradas.map((a) => a.bicoNumero || a.bicoId)).size} bicos
                    </td>
                    <td className="py-2.5 px-3 font-mono">{balancoConsolidado.totalAfericoes} testes</td>
                    <td className="py-2.5 px-3 font-mono">{balancoConsolidado.volumeTotalAferido.toFixed(3)} L</td>
                    <td className="py-2.5 px-3">—</td>
                    <td className="py-2.5 px-3 font-mono text-emerald-800">
                      {formatarMoeda(balancoConsolidado.valorTotalAfericoesGeral)}
                    </td>
                    <td className="py-2.5 px-3 font-mono">
                      {balancoConsolidado.desvioMedioMl > 0 ? '+' : ''}{balancoConsolidado.desvioMedioMl} ml
                    </td>
                    <td className="py-2.5 px-3 font-mono bg-blue-100/60 text-blue-950 font-extrabold">
                      {balancoConsolidado.impactoMedioGeralLitros1000L > 0 ? '+' : ''}
                      {balancoConsolidado.impactoMedioGeralLitros1000L.toFixed(2)} L / 1.000L
                    </td>
                    <td className="py-2.5 px-3 font-mono bg-blue-100/60 text-blue-950 font-extrabold">
                      {balancoConsolidado.impactoMedioGeralFinanceiro1000L > 0 ? '+' : ''}
                      {formatarMoeda(balancoConsolidado.impactoMedioGeralFinanceiro1000L)} / 1.000L
                    </td>
                    <td className="py-2.5 px-3 text-emerald-800">{balancoConsolidado.taxaConformidade}% conf.</td>
                  </tr>
                </tfoot>
              )}
            </ReportTable>
          </div>
        </div>

        {/* VISUALIZAÇÃO AGRUPADA POR COMBUSTÍVEL */}
        {agrupamentoAfericoes === 'COMBUSTIVEL' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-200 pb-2">
              <h5 className="text-sm font-bold text-slate-800 uppercase tracking-wide flex items-center gap-2">
                <Fuel className="w-4 h-4 text-blue-600" />
                Detalhamento dos Ensaios Volumétricos Agrupados por Tipo de Combustível
              </h5>
              <span className="text-xs text-slate-500 font-mono">
                {balancoConsolidado.resumoPorCombustivel.length} combustível(is) exibido(s)
              </span>
            </div>

            {balancoConsolidado.resumoPorCombustivel.length === 0 ? (
              <div className="p-8 text-center text-slate-400 bg-slate-50 rounded-xl border border-slate-200">
                Nenhum ensaio metrológico para os filtros selecionados.
              </div>
            ) : (
              balancoConsolidado.resumoPorCombustivel.map((comb: any) => {
                const isExpandido = combustiveisExpandidos[comb.produto] !== false;
                const testes = comb.listaAfericoes || [];

                return (
                  <div
                    key={`grupo-comb-${comb.produto}`}
                    className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden transition-all"
                  >
                    {/* Header do Grupo de Combustível */}
                    <div
                      onClick={() =>
                        setCombustiveisExpandidos((prev) => ({
                          ...prev,
                          [comb.produto]: !isExpandido,
                        }))
                      }
                      className="p-4 bg-gradient-to-r from-slate-900 to-slate-800 text-white flex flex-col md:flex-row md:items-center justify-between gap-3 cursor-pointer hover:from-slate-800 hover:to-slate-700 transition"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-500/20 text-blue-300 rounded-lg border border-blue-400/30">
                          <Fuel className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h5 className="font-bold text-sm tracking-wide text-white">{comb.produto}</h5>
                            <span className="text-xs font-mono font-bold px-2 py-0.5 bg-white/10 rounded border border-white/20 text-emerald-300">
                              {formatarMoeda(comb.precoMedioLitro)}/L
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-300 mt-0.5">
                            {comb.bicosQtd} bico(s) cadastrado(s) ({comb.bicosNumeros.map((n: number) => `Bico ${String(n).padStart(2, '0')}`).join(', ')}) • {comb.qtdTestes} teste(s) de 20L
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
                            {comb.conformes} conf. ({comb.taxaConformidade}%)
                          </span>
                          {comb.naoConformes > 0 && (
                            <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30 font-bold">
                              {comb.naoConformes} fora de faixa
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          className="p-1 rounded bg-white/10 hover:bg-white/20 text-white transition"
                        >
                          {isExpandido ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Resumo Rápido das Métricas do Combustível */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 bg-slate-50 border-b border-slate-200 text-xs">
                      <div className="p-2 bg-white rounded-lg border border-slate-200">
                        <span className="text-[10px] font-bold uppercase text-slate-400 block">Volume Total Aferido</span>
                        <strong className="font-mono text-slate-900 text-sm">
                          {comb.volumeAferidoTotal.toFixed(3)} L
                        </strong>
                      </div>
                      <div className="p-2 bg-white rounded-lg border border-slate-200">
                        <span className="text-[10px] font-bold uppercase text-slate-400 block">Valor Total Aferido</span>
                        <strong className="font-mono text-emerald-700 text-sm">
                          {formatarMoeda(comb.valorTotalAfericao)}
                        </strong>
                      </div>
                      <div className="p-2 bg-white rounded-lg border border-slate-200">
                        <span className="text-[10px] font-bold uppercase text-slate-400 block">Desvio Médio 20L</span>
                        <strong
                          className={`font-mono text-sm font-bold ${
                            comb.desvioMedioMl > 0
                              ? 'text-amber-700'
                              : comb.desvioMedioMl < 0
                              ? 'text-blue-700'
                              : 'text-slate-800'
                          }`}
                        >
                          {comb.desvioMedioMl > 0 ? '+' : ''}
                          {comb.desvioMedioMl} ml
                        </strong>
                      </div>
                      <div className="p-2 bg-white rounded-lg border border-slate-200">
                        <span className="text-[10px] font-bold uppercase text-slate-400 block">Impacto / 1.000 L</span>
                        <strong
                          className={`font-mono text-sm font-bold ${
                            comb.impactoLitrosPor1000L > 0
                              ? 'text-amber-700'
                              : comb.impactoLitrosPor1000L < 0
                              ? 'text-blue-700'
                              : 'text-slate-800'
                          }`}
                        >
                          {comb.impactoLitrosPor1000L > 0 ? '+' : ''}
                          {comb.impactoLitrosPor1000L.toFixed(2)} L
                        </strong>
                        <span className="text-[10px] text-slate-500 block">
                          {comb.impactoFinanceiroPor1000L > 0 ? '+' : ''}
                          {formatarMoeda(comb.impactoFinanceiroPor1000L)}
                        </span>
                      </div>
                    </div>

                    {/* Tabela dos Ensaios Volumétricos daquele Combustível */}
                    {isExpandido && (
                      <div className="overflow-x-auto">
                        <ReportTable className="w-full text-xs text-left">
                          <thead className="bg-slate-100 border-b border-slate-200 font-bold text-slate-700 uppercase text-[11px]">
                            <tr>
                              <th className="py-2.5 px-3">Data / Hora</th>
                              <th className="py-2.5 px-3">Bico</th>
                              <th className="py-2.5 px-3">Nominal</th>
                              <th className="py-2.5 px-3">Vol. Aferido</th>
                              <th className="py-2.5 px-3">Desvio (ml)</th>
                              <th className="py-2.5 px-3 font-bold text-emerald-900">Valor Teste (R$)</th>
                              <th className="py-2.5 px-3">Responsável</th>
                              <th className="py-2.5 px-3">Status Inmetro</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {testes.length === 0 ? (
                              <tr>
                                <td colSpan={8} className="py-5 text-center text-slate-400">
                                  Nenhum ensaio individual registrado para este combustível.
                                </td>
                              </tr>
                            ) : (
                              testes.map((a: any) => {
                                const bicoNum =
                                  a.bicoNumero ?? (a.bicoId ? parseInt(a.bicoId.replace(/\D/g, ''), 10) : 1);
                                const isOk = a.resultado === 'CONFORME';

                                return (
                                  <tr key={a.id} className="hover:bg-slate-50">
                                    <td className="py-2 px-3 font-mono text-slate-700">
                                      {a.data} {a.hora || ''}
                                    </td>
                                    <td className="py-2 px-3 font-bold text-slate-900">
                                      Bico {String(bicoNum).padStart(2, '0')}
                                      
                                    </td>
                                    <td className="py-2 px-3 font-mono">
                                      {Number(a.volumeNominal || 20).toFixed(3)} L
                                    </td>
                                    <td className="py-2 px-3 font-mono font-bold text-slate-900">
                                      {Number(a.volumeAferido || 20).toFixed(3)} L
                                    </td>
                                    <td className="py-2 px-3 font-mono font-bold">
                                      <span
                                        className={
                                          Math.abs(a.desvioMl) > 100 ? 'text-red-600' : 'text-emerald-700'
                                        }
                                      >
                                        {a.desvioMl > 0 ? '+' : ''}
                                        {a.desvioMl} ml
                                      </span>
                                    </td>
                                    <td className="py-2 px-3 font-mono font-bold text-emerald-700">
                                      {formatarMoeda(a.valorTeste)}
                                    </td>
                                    <td className="py-2 px-3">{a.responsavelNome || 'Operador'}</td>
                                    <td className="py-2 px-3">
                                      <span
                                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                          isOk
                                            ? 'bg-emerald-100 text-emerald-800'
                                            : 'bg-red-100 text-red-800'
                                        }`}
                                      >
                                        {a.resultado}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                          {testes.length > 0 && (
                            <tfoot className="bg-slate-50 border-t border-slate-200 font-bold text-slate-900">
                              <tr>
                                <td className="py-2 px-3 uppercase text-[10px]" colSpan={2}>
                                  Subtotal {comb.produto} ({testes.length} ensaios)
                                </td>
                                <td className="py-2 px-3 font-mono">
                                  {(testes.length * 20).toFixed(3)} L
                                </td>
                                <td className="py-2 px-3 font-mono">
                                  {comb.volumeAferidoTotal.toFixed(3)} L
                                </td>
                                <td className="py-2 px-3 font-mono">
                                  {comb.desvioMedioMl > 0 ? '+' : ''}
                                  {comb.desvioMedioMl} ml méd.
                                </td>
                                <td className="py-2 px-3 font-mono text-emerald-800">
                                  {formatarMoeda(comb.valorTotalAfericao)}
                                </td>
                                <td className="py-2 px-3">
                                  —
                                </td>
                                <td className="py-2 px-3 text-emerald-800">
                                  {comb.conformes} de {testes.length} conf.
                                </td>
                              </tr>
                            </tfoot>
                          )}
                        </ReportTable>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* VISUALIZAÇÃO POR BICO */}
        {(agrupamentoAfericoes === 'BICO' || agrupamentoAfericoes === 'CRONOLOGICO') && (
          <div className="space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
              <h5 className="text-xs font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-indigo-600" />
                Informações de Bicos Aferidos & Valor Total por Bico
              </h5>
              <span className="text-[11px] text-slate-500">
                Testes, volumes e desvios por bico
              </span>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <ReportTable className="w-full text-xs text-left">
                <thead className="bg-slate-100 border-b border-slate-200 font-bold text-slate-700 uppercase">
                  <tr>
                    <th className="py-2.5 px-3">Bico</th>
                    <th className="py-2.5 px-3">Combustível</th>
                    <th className="py-2.5 px-3">Testes</th>
                    <th className="py-2.5 px-3">Volume Total</th>
                    <th className="py-2.5 px-3">Preço (R$/L)</th>
                    <th className="py-2.5 px-3 font-bold text-emerald-900">Valor Total do Bico</th>
                    <th className="py-2.5 px-3">Desvio Médio</th>
                    <th className="py-2.5 px-3">Impacto / 1.000 L</th>
                    <th className="py-2.5 px-3">Status Inmetro</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {balancoConsolidado.resumoPorBico.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-6 text-center text-slate-400">
                        Nenhum bico aferido no período selecionado.
                      </td>
                    </tr>
                  ) : (
                    balancoConsolidado.resumoPorBico.map((b: any) => (
                      <tr key={b.bicoNumero} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-bold text-slate-900">
                          Bico {String(b.bicoNumero).padStart(2, '0')}
                          
                        </td>
                        <td className="py-2 px-3 font-medium text-slate-800">{b.produto}</td>
                        <td className="py-2 px-3 font-mono">{b.qtdTestes}x</td>
                        <td className="py-2 px-3 font-mono font-semibold">{b.volumeAferidoTotal.toFixed(3)} L</td>
                        <td className="py-2 px-3 font-mono">{formatarMoeda(b.precoLitro)}</td>
                        <td className="py-2 px-3 font-mono font-bold text-emerald-700">
                          {formatarMoeda(b.valorTotalAfericao)}
                        </td>
                        <td className="py-2 px-3 font-mono font-bold">
                          <span className={b.desvioMedioMl > 0 ? 'text-amber-700' : b.desvioMedioMl < 0 ? 'text-blue-700' : 'text-slate-700'}>
                            {b.desvioMedioMl > 0 ? '+' : ''}{b.desvioMedioMl} ml
                          </span>
                        </td>
                        <td className="py-2 px-3 font-mono text-[11px]">
                          <span className={b.impactoLitrosPor1000L > 0 ? 'text-amber-800 font-bold' : b.impactoLitrosPor1000L < 0 ? 'text-blue-800 font-bold' : 'text-slate-600'}>
                            {b.impactoLitrosPor1000L > 0 ? '+' : ''}{b.impactoLitrosPor1000L.toFixed(2)} L
                          </span>
                          <span className="block text-[10px] text-slate-400">
                            {b.impactoFinanceiroPor1000L > 0 ? '+' : ''}{formatarMoeda(b.impactoFinanceiroPor1000L)}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              b.statusGeral === 'CONFORME'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {b.statusGeral}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {balancoConsolidado.resumoPorBico.length > 0 && (
                  <tfoot className="bg-slate-50 border-t border-slate-200 font-bold text-slate-900">
                    <tr>
                      <td className="py-2 px-3 uppercase text-[11px]" colSpan={2}>
                        Total de {balancoConsolidado.resumoPorBico.length} bicos aferidos
                      </td>
                      <td className="py-2 px-3 font-mono">{balancoConsolidado.totalAfericoes}</td>
                      <td className="py-2 px-3 font-mono">{balancoConsolidado.volumeTotalAferido.toFixed(3)} L</td>
                      <td className="py-2 px-3">—</td>
                      <td className="py-2 px-3 font-mono text-emerald-800">
                        {formatarMoeda(balancoConsolidado.valorTotalAfericoesGeral)}
                      </td>
                      <td className="py-2 px-3 font-mono">
                        {balancoConsolidado.desvioMedioMl > 0 ? '+' : ''}{balancoConsolidado.desvioMedioMl} ml
                      </td>
                      <td className="py-2 px-3 font-mono text-blue-900">
                        {balancoConsolidado.impactoMedioGeralLitros1000L > 0 ? '+' : ''}
                        {balancoConsolidado.impactoMedioGeralLitros1000L.toFixed(2)} L
                      </td>
                      <td className="py-2 px-3 text-emerald-800">{balancoConsolidado.afericoesConformes} conf.</td>
                    </tr>
                  </tfoot>
                )}
              </ReportTable>
            </div>
          </div>
        )}

        {/* VISUALIZAÇÃO CRONOLÓGICA */}
        {agrupamentoAfericoes === 'CRONOLOGICO' && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h5 className="text-xs font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                <FileCheck className="w-3.5 h-3.5 text-slate-600" />
                Histórico Cronológico de Ensaios Volumétricos ({afericoesFiltradas.length} registros)
              </h5>
              <span className="text-[11px] text-slate-500">
                Registros individuais de 20 Litros no período
              </span>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <ReportTable className="w-full text-xs text-left">
                <thead className="bg-slate-100 border-b border-slate-200 font-bold text-slate-700 uppercase">
                  <tr>
                    <th className="py-2.5 px-3">Data / Hora</th>
                    <th className="py-2.5 px-3">Bico / Combustível</th>
                    <th className="py-2.5 px-3">Nominal</th>
                    <th className="py-2.5 px-3">Volume Aferido</th>
                    <th className="py-2.5 px-3">Desvio (ml)</th>
                    <th className="py-2.5 px-3">Valor do Teste (R$)</th>
                    <th className="py-2.5 px-3">Responsável</th>
                    <th className="py-2.5 px-3">Resultado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {afericoesFiltradas.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-slate-400">
                        Nenhuma aferição registrada no período selecionado.
                      </td>
                    </tr>
                  ) : (
                    afericoesFiltradas.map((a) => {
                      const desvioMl = Math.round((Number(a.diferenca) || 0) * 1000);
                      const bicoNum = a.bicoNumero ?? (a.bicoId ? parseInt(a.bicoId.replace(/\D/g, ''), 10) : 1);
                      const preco = resolverPrecoBico(a.bicoId, bicoNum, a.produto);
                      const valTeste = (Number(a.volumeNominal) || 20) * preco;

                      return (
                        <tr key={a.id} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-mono">
                            {a.data} {a.hora}
                          </td>
                          <td className="py-2 px-3 font-medium text-slate-900">
                            Bico {String(bicoNum).padStart(2, '0')} • {a.produto}
                          </td>
                          <td className="py-2 px-3 font-mono">{a.volumeNominal ? a.volumeNominal.toFixed(3) : '20.000'} L</td>
                          <td className="py-2 px-3 font-mono font-bold">
                            {a.volumeAferido ? a.volumeAferido.toFixed(3) : '20.000'} L
                          </td>
                          <td className="py-2 px-3 font-mono font-bold">
                            <span
                              className={
                                Math.abs(desvioMl) > 100 ? 'text-red-600' : 'text-emerald-700'
                              }
                            >
                              {desvioMl > 0 ? '+' : ''}
                              {desvioMl} ml
                            </span>
                          </td>
                          <td className="py-2 px-3 font-mono font-bold text-emerald-700">
                            {formatarMoeda(valTeste)}
                          </td>
                          <td className="py-2 px-3">{a.responsavelNome || 'Operador'}</td>
                          <td className="py-2 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                a.resultado === 'CONFORME'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-red-100 text-red-800'
                              }`}
                            >
                              {a.resultado}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </ReportTable>
            </div>
          </div>
        )}
      </div>
    );
  };

  /**
   * Renderização do Painel Exclusivo de Agrupamento por Combustível
   * Exibe visão consolidada e detalhada de Tanques, Bicos, Aferições Inmetro e Qualidade ANP
   * organizados individualmente por tipo de combustível.
   */
  const renderPainelAgrupadoPorCombustivel = () => {
    return (
      <div className="space-y-8 pt-2">
        {/* Cabeçalho do Painel por Combustível */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <h4 className="text-base font-bold text-slate-900 uppercase flex items-center gap-2">
              <Fuel className="w-5 h-5 text-blue-600" />
              Relatório Consolidado & Agrupado por Combustível
            </h4>
            <p className="text-xs text-slate-500 mt-1">
              Aferições, estoque e qualidade agrupados por combustível.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 bg-blue-50 text-blue-900 border border-blue-200 rounded-lg text-xs font-bold font-mono">
              {balancoConsolidado.agrupadoPorCombustivel.length} produtos mapeados
            </span>
          </div>
        </div>

        {/* Grade de Cards Executivos de Combustíveis */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {balancoConsolidado.agrupadoPorCombustivel.map((comb: any) => {
            const isAberto = combustivelAberto === comb.produto;
            return (
              <div
                key={comb.produto}
                className={`rounded-xl border transition-all shadow-xs overflow-hidden ${
                  isAberto
                    ? 'border-blue-500 ring-2 ring-blue-500/20 bg-white'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                {/* Header do Card de Combustível */}
                <div className="p-4 bg-gradient-to-r from-slate-900 to-slate-800 text-white flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-blue-500/20 text-blue-300 rounded-lg border border-blue-400/30">
                      <Fuel className="w-4 h-4" />
                    </div>
                    <div>
                      <h5 className="font-bold text-sm tracking-wide">{comb.produto}</h5>
                      <span className="text-[10px] text-slate-300">
                        {comb.bicos.length} Bico(s)
                      </span>
                    </div>
                  </div>
                  <span className="text-xs font-mono font-bold px-2.5 py-1 bg-white/10 rounded-md border border-white/20">
                    {formatarMoeda(comb.precoMedio)}/L
                  </span>
                </div>

                {/* Resumo de Indicadores */}
                <div className="p-4 space-y-3.5 text-xs">
                  {/* Metrologia Inmetro (Aferições 20L & Impacto 1.000L) */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 bg-blue-50/60 border border-blue-200 rounded-lg">
                      <span className="text-[10px] font-bold uppercase text-blue-900 block">Desvio Médio 20L</span>
                      <strong className={`text-sm font-mono font-bold ${comb.desvioMedioMl > 0 ? 'text-amber-800' : comb.desvioMedioMl < 0 ? 'text-blue-900' : 'text-slate-800'}`}>
                        {comb.desvioMedioMl > 0 ? '+' : ''}{comb.desvioMedioMl} ml
                      </strong>
                      <span className="text-[9.5px] text-blue-800 block mt-0.5">
                        {comb.totalAfericoes} teste(s) de pista
                      </span>
                    </div>

                    <div className="p-2 bg-emerald-50/60 border border-emerald-200 rounded-lg">
                      <span className="text-[10px] font-bold uppercase text-emerald-900 block">Impacto / 1.000 L</span>
                      <strong className={`text-sm font-mono font-bold ${comb.impactoLitros1000L > 0 ? 'text-amber-800' : comb.impactoLitros1000L < 0 ? 'text-blue-900' : 'text-emerald-900'}`}>
                        {comb.impactoLitros1000L > 0 ? '+' : ''}{comb.impactoLitros1000L.toFixed(2)} L
                      </strong>
                      <span className="text-[9.5px] text-emerald-800 block mt-0.5">
                        {comb.impactoFinanceiro1000L > 0 ? '+' : ''}{formatarMoeda(comb.impactoFinanceiro1000L)}
                      </span>
                    </div>
                  </div>

                  {/* Qualidade e Conformidade */}
                  <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-600" />
                      <span className="font-semibold text-slate-700">Inmetro: {comb.taxaInmetro}%</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <FlaskConical className="w-4 h-4 text-purple-600" />
                      <span className="font-semibold text-slate-700">ANP: {comb.taxaAnp}%</span>
                    </div>
                  </div>

                  {/* Botão de Expansão Detalhada */}
                  <button
                    onClick={() => setCombustivelAberto(isAberto ? null : comb.produto)}
                    className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1 mt-2 cursor-pointer"
                  >
                    <span>{isAberto ? 'Recolher Detalhes' : 'Ver Detalhes do Produto'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Detalhamento Aberto do Produto Selecionado */}
        {balancoConsolidado.agrupadoPorCombustivel.map((comb: any) => {
          if (combustivelAberto && combustivelAberto !== comb.produto) return null;
          return (
            <div key={`detalhes-${comb.produto}`} className="bg-slate-50/80 p-5 rounded-2xl border border-slate-300 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-200 pb-3">
                <h5 className="text-base font-bold text-slate-900 uppercase flex items-center gap-2">
                  <Fuel className="w-5 h-5 text-blue-600" />
                  Detalhamento Metrológico & Operacional: {comb.produto}
                </h5>
                <span className="text-xs font-mono bg-white px-3 py-1 rounded-lg border border-slate-200 text-slate-700 font-bold">
                  Preço Praticado: {formatarMoeda(comb.precoMedio)} / Litro
                </span>
              </div>

              {/* Tabela de Bicos & Bombas Vinculados */}
              <div className="space-y-2">
                <h6 className="text-xs font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                  ⛽ Bicos de Abastecimento Ativos ({comb.bicos.length})
                </h6>
                <div className="overflow-x-auto bg-white border border-slate-200 rounded-xl">
                  <ReportTable className="w-full text-xs text-left">
                    <thead className="bg-slate-100 font-bold text-slate-700 uppercase border-b border-slate-200">
                      <tr>
                        <th className="py-2 px-3">Bico Nº</th>
                        
                        <th className="py-2 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {comb.bicos.length === 0 ? (
                        <tr>
                          <td colSpan={2} className="py-3 px-3 text-slate-400 text-center">Nenhum bico vinculado a este combustível.</td>
                        </tr>
                      ) : (
                        comb.bicos.map((b: any) => (
                          <tr key={b.id || b.numero}>
                            <td className="py-2 px-3 font-bold text-slate-900">Bico {String(b.numero).padStart(2, '0')}</td>
                            
                            <td className="py-2 px-3 font-semibold text-emerald-700">{b.status || 'Ativo'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </ReportTable>
                </div>
              </div>

              {/* Tabela 3: Aferições de Pista */}
              <div className="space-y-2">
                <h6 className="text-xs font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                  📐 Histórico de Ensaios Metrológicos Inmetro ({comb.afericoes.length})
                </h6>
                <div className="overflow-x-auto bg-white border border-slate-200 rounded-xl">
                  <ReportTable className="w-full text-xs text-left">
                    <thead className="bg-slate-100 font-bold text-slate-700 uppercase border-b border-slate-200">
                      <tr>
                        <th className="py-2 px-3">Data / Hora</th>
                        <th className="py-2 px-3">Bico</th>
                        <th className="py-2 px-3">Vol. Aferido (20L)</th>
                        <th className="py-2 px-3">Desvio ml (20L)</th>
                        <th className="py-2 px-3">Impacto / 1.000 L</th>
                        <th className="py-2 px-3">Resultado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {comb.afericoes.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-3 px-3 text-slate-400 text-center">Nenhum ensaio metrológico registrado no período.</td>
                        </tr>
                      ) : (
                        comb.afericoes.map((a: any, idx: number) => {
                          const desvMl = Math.round((Number(a.diferenca) || 0) * 1000);
                          const imp1k = Number(((desvMl * 50) / 1000).toFixed(2));
                          return (
                            <tr key={a.id || idx}>
                              <td className="py-2 px-3 font-mono">{a.data} {a.hora || ''}</td>
                              <td className="py-2 px-3 font-bold text-slate-800">
                                Bico {String(a.bicoNumero || a.bicoId).padStart(2, '0')}
                              </td>
                              <td className="py-2 px-3 font-mono font-semibold">{(Number(a.volumeAferido) || 20).toFixed(3)} L</td>
                              <td className="py-2 px-3 font-mono font-bold">
                                <span className={desvMl > 0 ? 'text-amber-700' : desvMl < 0 ? 'text-blue-700' : 'text-slate-700'}>
                                  {desvMl > 0 ? '+' : ''}{desvMl} ml
                                </span>
                              </td>
                              <td className="py-2 px-3 font-mono font-bold text-blue-900">
                                {imp1k > 0 ? '+' : ''}{imp1k.toFixed(2)} L
                              </td>
                              <td className="py-2 px-3">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${a.resultado === 'CONFORME' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                                  {a.resultado || 'CONFORME'}
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </ReportTable>
                </div>
              </div>

              {/* Tabela 4: Laudos Físico-Químicos e Densidade ANP */}
              <div className="space-y-2">
                <h6 className="text-xs font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                  🔬 Ensaios de Qualidade & Densidade ANP ({comb.densidades.length})
                </h6>
                <div className="overflow-x-auto bg-white border border-slate-200 rounded-xl">
                  <ReportTable className="w-full text-xs text-left">
                    <thead className="bg-slate-100 font-bold text-slate-700 uppercase border-b border-slate-200">
                      <tr>
                        <th className="py-2 px-3">Data / Hora</th>
                        <th className="py-2 px-3">Ensaio / Teste</th>
                        <th className="py-2 px-3">Densidade Lida</th>
                        <th className="py-2 px-3">Temperatura (°C)</th>
                        <th className="py-2 px-3">Densidade 20°C</th>
                        <th className="py-2 px-3">Status ANP</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {comb.densidades.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-3 px-3 text-slate-400 text-center">Nenhum laudo de qualidade ANP registrado no período.</td>
                        </tr>
                      ) : (
                        comb.densidades.map((d: any, idx: number) => (
                          <tr key={d.id || idx}>
                            <td className="py-2 px-3 font-mono">{d.data} {d.hora || ''}</td>
                            <td className="py-2 px-3 font-medium text-slate-800">{d.tipoTeste || 'Densidade & Proveta'}</td>
                            <td className="py-2 px-3 font-mono font-bold text-slate-900">{d.densidadeObservada ? Number(d.densidadeObservada).toFixed(4) : '—'} g/cm³</td>
                            <td className="py-2 px-3 font-mono">{d.temperatura ? `${Number(d.temperatura).toFixed(1)} °C` : '20.0 °C'}</td>
                            <td className="py-2 px-3 font-mono font-bold text-purple-900">{d.densidade20C ? Number(d.densidade20C).toFixed(4) : '—'} g/cm³</td>
                            <td className="py-2 px-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${(d.resultado || d.status) === 'CONFORME' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                                {d.resultado || d.status || 'CONFORME'}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </ReportTable>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  /**
   * Renderizador do Modo Simplificado e Amigável para Telas Mobile / Smartphone
   */
  const renderModoSimplificadoMobile = () => {
    const kpis = balancoConsolidado;
    const dif = kpis.saldoDiferenca || 0;

    return (
      <div className="space-y-6">
        {/* Banner Superior com Ação de Download do PDF Mobile */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white p-5 rounded-2xl border border-slate-700 shadow-md flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-emerald-500/20 text-emerald-400 rounded-lg">
                <Smartphone className="w-5 h-5" />
              </span>
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                Relatório Simplificado Mobile
              </span>
            </div>
            <h3 className="text-lg font-bold text-white">
              Painel Executivo do Posto
            </h3>
            <p className="text-xs text-slate-300">
              Visualização limpa, números essenciais e exportação formatada para leitura em smartphones e WhatsApp.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => handleExportarCombustivel5ColunasPDF('MOBILE')}
              disabled={gerandoPdf}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-3 bg-teal-500 hover:bg-teal-600 active:scale-[0.98] text-slate-950 font-bold rounded-xl text-xs transition shadow-lg shadow-teal-500/10 disabled:opacity-50 cursor-pointer min-h-[44px]"
              title="Gera o Relatório Simplificado de Combustíveis nas 5 Colunas (PDF Mobile 9:16)"
            >
              <Fuel className="w-4 h-4 text-slate-950" />
              <span>PDF 5 Colunas (Mobile)</span>
            </button>

            <button
              onClick={() => handleGerarPdfMobile()}
              disabled={gerandoPdf}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-3 bg-emerald-500 hover:bg-emerald-600 active:scale-[0.98] text-slate-950 font-bold rounded-xl text-xs transition shadow-lg shadow-emerald-500/10 disabled:opacity-50 cursor-pointer min-h-[44px]"
              title="Gera o PDF executivo vertical para o celular ou envio no WhatsApp"
            >
              <Smartphone className="w-4 h-4 text-slate-950" />
              <span>{gerandoPdf ? 'Gerando...' : 'PDF Geral Mobile'}</span>
            </button>

            <button
              onClick={() => handleExportarPDF('BALANCO_CONSOLIDADO')}
              disabled={gerandoPdf}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-3 bg-slate-800 hover:bg-slate-700 active:scale-[0.98] text-slate-200 font-semibold rounded-xl text-xs transition border border-slate-700 disabled:opacity-50 cursor-pointer min-h-[44px]"
              title="Gera o PDF clássico A4 com todas as tabelas completas para impressão em papel"
            >
              <FileDown className="w-4 h-4 text-blue-400" />
              <span>PDF A4 Tradicional</span>
            </button>
          </div>
        </div>

        {/* Barra de Filtros Rápidos de 1 Toque */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-700 uppercase flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-slate-500" />
              Período Rápido
            </span>
            <div className="text-xs text-slate-500 font-medium">
              Ativo: <span className="font-bold text-slate-800">{formatarDataBR(dataInicio)}</span> até{' '}
              <span className="font-bold text-slate-800">{formatarDataBR(dataFim)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              onClick={() => aplicarFiltroRapido('HOJE')}
              className="px-3 py-2 text-xs font-bold rounded-lg border border-slate-200 hover:border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 transition cursor-pointer min-h-[44px] flex items-center justify-center"
            >
              Hoje
            </button>
            <button
              onClick={() => aplicarFiltroRapido('ONTEM')}
              className="px-3 py-2 text-xs font-bold rounded-lg border border-slate-200 hover:border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 transition cursor-pointer min-h-[44px] flex items-center justify-center"
            >
              Ontem
            </button>
            <button
              onClick={() => aplicarFiltroRapido('7DIAS')}
              className="px-3 py-2 text-xs font-bold rounded-lg border border-slate-200 hover:border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 transition cursor-pointer min-h-[44px] flex items-center justify-center"
            >
              Últimos 7 dias
            </button>
            <button
              onClick={() => aplicarFiltroRapido('MES_ATUAL')}
              className="px-3 py-2 text-xs font-bold rounded-lg border border-slate-200 hover:border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 transition cursor-pointer min-h-[44px] flex items-center justify-center"
            >
              Mês Atual
            </button>
          </div>
        </div>

        {/* 4 Cards de Resumo Executivo (KPIs em grid responsivo) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Card 1: Caixa Conferido */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-xs text-slate-500 font-semibold uppercase">
                <span>Total em Caixa</span>
                <DollarSign className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                {formatarMoeda(kpis.totalConferido)}
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-slate-500">{kpis.totalFechamentos} turnos</span>
              <span className="text-slate-600 font-medium">
                Sistema: {formatarMoeda(kpis.totalInformado)}
              </span>
            </div>
          </div>

          {/* Card 2: Saldo / Diferença */}
          <div className={`p-4 rounded-xl border shadow-xs flex flex-col justify-between ${
            dif === 0
              ? 'bg-white border-slate-200'
              : dif > 0
              ? 'bg-blue-50/50 border-blue-200'
              : 'bg-red-50/50 border-red-200'
          }`}>
            <div>
              <div className="flex items-center justify-between text-xs text-slate-500 font-semibold uppercase">
                <span>Saldo Diferença</span>
                {dif === 0 ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : dif > 0 ? (
                  <TrendingUp className="w-4 h-4 text-blue-600" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                )}
              </div>
              <div className={`text-2xl font-bold mt-1 tabular-nums ${
                dif === 0
                  ? 'text-emerald-700'
                  : dif > 0
                  ? 'text-blue-700'
                  : 'text-red-700'
              }`}>
                {dif > 0 ? '+' : ''}{formatarMoeda(dif)}
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-100/80 text-xs">
              <span className={dif === 0 ? 'text-emerald-600 font-medium' : dif > 0 ? 'text-blue-600 font-medium' : 'text-red-600 font-medium'}>
                {dif === 0
                  ? '✓ Caixa 100% conferido'
                  : dif > 0
                  ? `Sobra de ${formatarMoeda(dif)}`
                  : `Falta de ${formatarMoeda(Math.abs(dif))}`}
              </span>
            </div>
          </div>

          {/* Card 3: Volume de Combustível */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-xs text-slate-500 font-semibold uppercase">
                <span>Volume Combustíveis</span>
                <Fuel className="w-4 h-4 text-blue-600" />
              </div>
              <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                {formatarLitros(kpis.volumeTotalAferido)}
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-100 text-xs text-slate-500 flex items-center justify-between">
              <span>{kpis.agrupadoPorCombustivel.length} produtos</span>
              <span className="font-semibold text-slate-700">
                {formatarMoeda(kpis.valorTotalAfericoesGeral)}
              </span>
            </div>
          </div>

          {/* Card 4: Aferições Metrológicas 20L */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-xs text-slate-500 font-semibold uppercase">
                <span>Aferições 20L (Inmetro)</span>
                <Gauge className="w-4 h-4 text-teal-600" />
              </div>
              <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                {kpis.taxaConformidade}%
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-100 text-xs text-slate-500 flex items-center justify-between">
              <span>{kpis.afericoesConformes}/{kpis.totalAfericoes} conformes</span>
              <span className="font-mono text-slate-700">
                {kpis.desvioMedioMl > 0 ? '+' : ''}{kpis.desvioMedioMl} ml
              </span>
            </div>
          </div>
        </div>

        {/* Abas Rápidas no Modo Simplificado */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl overflow-x-auto">
          {[
            { id: 'TODOS', label: 'Visão Geral' },
            { id: 'CAIXA', label: `Caixa (${fechamentosFiltrados.length})` },
            { id: 'COMBUSTIVEL', label: `Combustíveis (${kpis.agrupadoPorCombustivel.length})` },
            { id: 'AFERICOES', label: `Aferições (${afericoesFiltradas.length})` },
            { id: 'ESCALA', label: `Escala (${escalasFiltradas.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setAbaSimplificada(tab.id as any)}
              className={`px-3.5 py-2 text-xs font-bold rounded-lg transition whitespace-nowrap cursor-pointer min-h-[40px] flex items-center ${
                abaSimplificada === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* CONTEÚDO: SEÇÃO DE FECHAMENTOS (Cartões Verticais Scannable) */}
        {(abaSimplificada === 'TODOS' || abaSimplificada === 'CAIXA') && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-900 uppercase flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-600" />
                Fechamentos de Caixa ({fechamentosFiltrados.length})
              </h4>
              <span className="text-xs text-slate-500">
                Formato em cartões verticais para celular
              </span>
            </div>

            {fechamentosFiltrados.length === 0 ? (
              <div className="bg-white p-8 rounded-xl border border-slate-200 text-center text-slate-500 text-sm">
                Nenhum fechamento registrado para o período selecionado.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {fechamentosFiltrados.map((f, idx) => {
                  const difItem = f.diferenca || 0;
                  return (
                    <div
                      key={f.id || idx}
                      className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3 transition hover:border-slate-300"
                    >
                      {/* Topo do Cartão: Operador e Turno */}
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-bold text-slate-900 text-sm">
                            {f.funcionarioNome || 'Operador'}
                          </div>
                          <div className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                            <span>{f.turno}</span>
                            <span>·</span>
                            <span>{formatarDataBR(f.data)}</span>
                          </div>
                        </div>

                        {/* Badge de Diferença */}
                        <div className={`px-2.5 py-1 rounded-lg text-xs font-bold tabular-nums ${
                          difItem === 0
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : difItem > 0
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'bg-red-50 text-red-700 border border-red-200'
                        }`}>
                          {difItem === 0
                            ? '✓ Sem Diferença'
                            : `${difItem > 0 ? '+ ' : ''}${formatarMoeda(difItem)} ${difItem > 0 ? 'Sobra' : 'Falta'}`}
                        </div>
                      </div>

                      {/* Valores: Físico vs Sistema */}
                      <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-lg text-xs">
                        <div>
                          <span className="text-slate-500 block text-[11px]">Total Conferido (Físico)</span>
                          <span className="font-bold text-slate-900 text-sm tabular-nums">
                            {formatarMoeda(f.totalConferido)}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[11px]">Total Registrado (Sistema)</span>
                          <span className="font-medium text-slate-700 text-sm tabular-nums">
                            {formatarMoeda(f.totalInformado)}
                          </span>
                        </div>
                      </div>

                      {/* Meios de Pagamento */}
                      <div className="text-xs text-slate-600 flex flex-wrap gap-x-3 gap-y-1">
                        <span>Dinheiro: <strong className="text-slate-800">{formatarMoeda(f.dinheiro || 0)}</strong></span>
                        <span>PIX: <strong className="text-slate-800">{formatarMoeda(f.pix || 0)}</strong></span>
                        <span>Cartão: <strong className="text-slate-800">{formatarMoeda((f.cartaoCredito || 0) + (f.cartaoDebito || 0))}</strong></span>
                      </div>

                      {/* Conferente */}
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
                        <span>Conferido por: {f.conferidoPor || 'Fiscal'}</span>
                        <span className="font-medium text-slate-500">{f.status || 'CONFERIDO'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* CONTEÚDO: RELATÓRIO SIMPLIFICADO POR COMBUSTÍVEL (5 COLUNAS OFICIAIS) */}
        {(abaSimplificada === 'TODOS' || abaSimplificada === 'COMBUSTIVEL') && (
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-bold text-slate-900 uppercase flex items-center gap-2">
                  <Fuel className="w-4 h-4 text-teal-600" />
                  Relatório por Combustível (5 Colunas)
                </h4>
                <p className="text-xs text-slate-500">
                  Combustível · Quantidade · Valor Unitário · Valor Total · Desvio
                </p>
              </div>

              {/* Botões de Exportação Rápida das 5 Colunas */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleExportarCombustivel5ColunasPDF('MOBILE')}
                  disabled={gerandoPdf}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-xs font-bold transition shadow-xs cursor-pointer min-h-[36px]"
                  title="Exportar PDF no formato Mobile (9:16) para WhatsApp"
                >
                  <Smartphone className="w-3.5 h-3.5 text-white" />
                  <span>PDF Mobile (5 Colunas)</span>
                </button>
                <button
                  onClick={() => handleExportarCombustivel5ColunasPDF('A4')}
                  disabled={gerandoPdf}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition cursor-pointer min-h-[36px]"
                  title="Exportar PDF em formato A4 impresso"
                >
                  <Download className="w-3.5 h-3.5 text-slate-600" />
                  <span>PDF A4</span>
                </button>
              </div>
            </div>

            {/* Visualização 1: Cartões Scannable para Telas Pequenas (sm:hidden) */}
            <div className="grid grid-cols-1 gap-3 sm:hidden">
              {relatorioCombustiveis5Colunas.map((comb) => (
                <div
                  key={comb.produto}
                  className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="font-bold text-slate-900 text-sm flex items-center gap-2">
                      <Fuel className="w-4 h-4 text-teal-600" />
                      {comb.produto}
                    </span>
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                        comb.statusDesvio === 'FALTA'
                          ? 'bg-red-50 text-red-700 border border-red-200'
                          : comb.statusDesvio === 'SOBRA'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-slate-50 text-slate-700 border border-slate-200'
                      }`}
                    >
                      {comb.desvioTexto}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-slate-50 p-2.5 rounded-lg">
                      <span className="text-slate-400 block text-[10px] uppercase font-semibold">Quantidade</span>
                      <span className="font-bold text-slate-900 text-sm font-mono">
                        {comb.quantidade.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L
                      </span>
                    </div>

                    <div className="bg-slate-50 p-2.5 rounded-lg">
                      <span className="text-slate-400 block text-[10px] uppercase font-semibold">Valor Unitário</span>
                      <span className="font-semibold text-slate-800 text-sm font-mono">
                        R$ {comb.valorUnitario.toFixed(2)} / L
                      </span>
                    </div>

                    <div className="bg-slate-50 p-2.5 rounded-lg col-span-2 flex items-center justify-between">
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">Valor Total</span>
                        <span className="font-bold text-slate-900 text-base font-mono">
                          {formatarMoeda(comb.valorTotal)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">Desvio</span>
                        <span
                          className={`font-bold text-xs ${
                            comb.statusDesvio === 'FALTA'
                              ? 'text-red-700'
                              : comb.statusDesvio === 'SOBRA'
                              ? 'text-emerald-700'
                              : 'text-slate-700'
                          }`}
                        >
                          {comb.desvioTexto}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Visualização 2: Tabela de Fácil Leitura (hidden sm:block) */}
            <div className="hidden sm:block overflow-x-auto bg-white border border-slate-200 rounded-xl shadow-xs">
              <ReportTable className="w-full text-xs text-left">
                <thead className="bg-slate-900 font-bold text-white uppercase text-[11px] tracking-wider">
                  <tr>
                    <th className="py-3 px-4 text-left">COMBUSTÍVEL</th>
                    <th className="py-3 px-4 text-right">QUANTIDADE</th>
                    <th className="py-3 px-4 text-right">VALOR UNITÁRIO</th>
                    <th className="py-3 px-4 text-right">VALOR TOTAL</th>
                    <th className="py-3 px-4 text-center">DESVIO</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {relatorioCombustiveis5Colunas.map((c) => (
                    <tr key={c.produto} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-bold text-slate-900 flex items-center gap-2">
                        <Fuel className="w-3.5 h-3.5 text-teal-600" />
                        <span>{c.produto}</span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-800">
                        {c.quantidade.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-600">
                        R$ {c.valorUnitario.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                        {formatarMoeda(c.valorTotal)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                            c.statusDesvio === 'FALTA'
                              ? 'bg-red-50 text-red-700 border border-red-200'
                              : c.statusDesvio === 'SOBRA'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {c.desvioTexto}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 font-bold text-slate-900 border-t-2 border-slate-300 text-xs">
                  <tr>
                    <td className="py-3 px-4 uppercase font-extrabold text-slate-800">TOTAL GERAL</td>
                    <td className="py-3 px-4 text-right font-mono text-slate-900 font-extrabold">
                      {relatorioCombustiveis5Colunas
                        .reduce((s, c) => s + c.quantidade, 0)
                        .toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                      L
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-600">
                      R${' '}
                      {(
                        relatorioCombustiveis5Colunas.reduce((s, c) => s + c.valorTotal, 0) /
                        Math.max(1, relatorioCombustiveis5Colunas.reduce((s, c) => s + c.quantidade, 0))
                      ).toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-900 font-extrabold text-sm">
                      {formatarMoeda(relatorioCombustiveis5Colunas.reduce((s, c) => s + c.valorTotal, 0))}
                    </td>
                    <td className="py-3 px-4 text-center font-mono">
                      <span
                        className={`font-bold ${
                          relatorioCombustiveis5Colunas.reduce((s, c) => s + (c.desvioLitros || 0), 0) < 0
                            ? 'text-red-700'
                            : 'text-emerald-700'
                        }`}
                      >
                        {relatorioCombustiveis5Colunas.reduce((s, c) => s + (c.desvioLitros || 0), 0) > 0 ? '+' : ''}
                        {relatorioCombustiveis5Colunas
                          .reduce((s, c) => s + (c.desvioLitros || 0), 0)
                          .toFixed(2)}{' '}
                        L
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </ReportTable>
            </div>
          </div>
        )}

        {/* CONTEÚDO: SEÇÃO DE AFERIÇÕES METROLÓGICAS 20L */}
        {(abaSimplificada === 'TODOS' || abaSimplificada === 'AFERICOES') && (
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-slate-900 uppercase flex items-center gap-2">
              <Gauge className="w-4 h-4 text-teal-600" />
              Aferições Metrológicas 20L ({afericoesFiltradas.length})
            </h4>

            {afericoesFiltradas.length === 0 ? (
              <div className="bg-white p-6 rounded-xl border border-slate-200 text-center text-slate-500 text-sm">
                Nenhuma aferição registrada no período.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {afericoesFiltradas.slice(0, 12).map((af, idx) => {
                  const conf = af.resultado === 'CONFORME';
                  const desvioMl = Math.round((Number(af.diferenca) || 0) * 1000);

                  return (
                    <div
                      key={af.id || idx}
                      className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900 text-xs">
                          {af.bicoNome || `Bico ${af.bicoId}`} · {af.produto}
                        </span>
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                          conf
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-red-50 text-red-700'
                        }`}>
                          {conf ? '✓ Conforme' : '⚠ Fora Limite'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-600 flex items-center justify-between">
                        <span>Desvio: <strong className={conf ? 'text-slate-800' : 'text-red-600'}>{desvioMl > 0 ? '+' : ''}{desvioMl} ml</strong></span>
                        <span className="text-slate-400">{formatarDataBR(af.data)}</span>
                      </div>
                      {af.responsavel && (
                        <div className="text-[11px] text-slate-400 pt-1 border-t border-slate-100">
                          Resp: {af.responsavel}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* CONTEÚDO: SEÇÃO DE ESCALA */}
        {(abaSimplificada === 'TODOS' || abaSimplificada === 'ESCALA') && (
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-slate-900 uppercase flex items-center gap-2">
              <Users className="w-4 h-4 text-indigo-600" />
              Escala de Funcionários ({escalasFiltradas.length})
            </h4>

            {escalasFiltradas.length === 0 ? (
              <div className="bg-white p-6 rounded-xl border border-slate-200 text-center text-slate-500 text-sm">
                Nenhum colaborador escalado no período.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {escalasFiltradas.slice(0, 15).map((esc, idx) => (
                  <div
                    key={esc.id || idx}
                    className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between"
                  >
                    <div>
                      <div className="font-bold text-slate-900 text-xs">
                        {esc.funcionarioNome}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {formatarDataBR(esc.data)} · {esc.horarioInicio || '06:00'} - {esc.horarioFim || '14:00'}
                      </div>
                    </div>
                    <div className="text-xs font-bold text-teal-700 bg-teal-50 px-2.5 py-1 rounded-md">
                      {esc.turno}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Rodapé Fixo / Bottom Action para Exportação Mobile */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            Deseja conferir o relatório completo com todas as colunas de auditoria?
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleGerarPdfMobile()}
              disabled={gerandoPdf}
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs transition cursor-pointer min-h-[40px]"
            >
              <Smartphone className="w-4 h-4" />
              {gerandoPdf ? 'Gerando PDF Mobile...' : 'Baixar PDF Mobile'}
            </button>
            <button
              onClick={() => setModoSimplificado(false)}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs transition cursor-pointer min-h-[40px]"
            >
              <Layers className="w-4 h-4" />
              Ver Tabelas Completas
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (modoTermico80mm) {
    return renderModoTermico80mm();
  }

  return (
    <div className="reports-view space-y-6">
      <style>{reportMobileStyles}</style>
      {/* Header Principal */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm print:hidden">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-blue-600" />
            Central de Relatórios & Balanço Consolidado
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Exportação em PDF formatado com dados de fechamento de caixa, auditoria, análise e aferições via jsPDF e autoTable.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onLimparDemonstracao && (
            <button
              onClick={onLimparDemonstracao}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-red-50 hover:bg-red-100 text-red-700 font-medium rounded-lg text-xs transition border border-red-200 cursor-pointer"
              title="Remover todos os dados de demonstração e resetar posto"
            >
              <Trash2 className="w-4 h-4 text-red-600" />
              Limpar Demonstração
            </button>
          )}

          <button
            onClick={() => setModoTermico80mm(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg text-xs transition shadow-sm cursor-pointer"
            title="Alternar para modo de relatório simplificado formatado para impressora térmica de 80mm"
          >
            <Receipt className="w-4 h-4 text-white" />
            Modo Térmica 80mm
          </button>

          <button
            onClick={handleExportarCsv}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs transition cursor-pointer"
          >
            <Download className="w-4 h-4" />
            Exportar CSV
          </button>

          <button
            onClick={handleImprimir}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs transition cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            Imprimir Tela
          </button>

          {tipo !== 'BALANCO_CONSOLIDADO' && (
            <button
              onClick={() => handleExportarPDF(tipo)}
              disabled={gerandoPdf}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-bold rounded-lg text-xs transition shadow-sm disabled:opacity-50 cursor-pointer min-h-[40px]"
            >
              <FileDown className="w-4 h-4 text-indigo-600" />
              PDF Módulo: {tipo}
            </button>
          )}

          <button
            onClick={() => handleGerarPdfMobile()}
            disabled={gerandoPdf}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs transition shadow-sm hover:shadow disabled:opacity-50 cursor-pointer min-h-[40px]"
            title="Gera um PDF vertical (9:16) com leitura limpa e cartões scannable para visualização rápida no celular e compartilhamento no WhatsApp"
          >
            <Smartphone className="w-4 h-4 text-emerald-200" />
            <span>
              {gerandoPdf ? 'Gerando PDF Mobile...' : 'Baixar PDF Mobile (WhatsApp)'}
            </span>
            <span className="hidden sm:inline-block px-1.5 py-0.5 text-[9px] font-extrabold bg-white/20 rounded uppercase tracking-wider">
              Celular 9:16
            </span>
          </button>

          <button
            onClick={() => handleExportarPDF('BALANCO_CONSOLIDADO')}
            disabled={gerandoPdf}
            className="inline-flex items-center gap-2.5 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold rounded-lg text-xs transition shadow-sm hover:shadow disabled:opacity-50 cursor-pointer min-h-[40px]"
            title="Gera um relatório completo formatado em PDF via jsPDF e AutoTable contendo Fechamento de Caixa, Auditoria, Análise ANP e Aferições Inmetro"
          >
            <FileDown className="w-4 h-4" />
            <span>
              {gerandoPdf
                ? 'Gerando Relatório PDF...'
                : 'Gerar PDF Formatado (A4 Mesa)'}
            </span>
            <span className="hidden sm:inline-block px-1.5 py-0.5 text-[9px] font-extrabold bg-white/20 rounded uppercase tracking-wider">
              jsPDF + AutoTable
            </span>
          </button>
        </div>
      </div>

      {/* Barra de Alternância: Modo Simplificado (Mobile & WhatsApp) vs Modo Detalhado */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900 text-white p-3.5 rounded-xl shadow-xs print:hidden">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-emerald-500/20 rounded-lg text-emerald-400">
            <Smartphone className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              Visualização de Relatórios
              <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded ${
                modoSimplificado ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
              }`}>
                {modoSimplificado ? 'Modo Simplificado Mobile' : 'Modo Analítico Completo'}
              </span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {modoSimplificado
                ? 'Layout direto em cartões, KPIs essenciais e exportação vertical para smartphone'
                : 'Tabelas completas de alta densidade com todas as colunas de conferência'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 bg-slate-800 p-1 rounded-lg">
          <button
            onClick={() => setModoSimplificado(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition cursor-pointer min-h-[36px] ${
              modoSimplificado
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            Modo Simplificado (Mobile)
          </button>
          <button
            onClick={() => setModoSimplificado(false)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition cursor-pointer min-h-[36px] ${
              !modoSimplificado
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Modo Detalhado (Tabelas)
          </button>
        </div>
      </div>

      {modoSimplificado ? (
        renderModoSimplificadoMobile()
      ) : (
        <>

      {/* Barra de Filtros e Seleção do Tipo */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 print:hidden">
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
            Módulo / Tipo de Relatório
          </label>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoRelatorio)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-800"
          >
            <option value="BALANCO_CONSOLIDADO">
              ★ Relatório Geral (Fechamento, Auditoria, Análise & Aferições)
            </option>
            <option value="COMBUSTIVEL_5COL">
              ★ Relatório por Combustível (5 Colunas: Combustível, Qtd, Preço, Total, Desvio)
            </option>
            <option value="AGRUPADO_COMBUSTIVEL">
              ★ Agrupamento por Combustível (Tanques, Bicos, Aferições & ANP)
            </option>
            <option value="FECHAMENTOS">1. Fechamentos de Caixa (Individual)</option>
            <option value="AFERICOES">
              2. Auditoria de Aferições & Impacto Metrológico (1.000 L / Bicos / Valores)
            </option>
            <option value="DENSIDADES">3. Análises de Qualidade e Densidade ANP (Individual)</option>
            <option value="AUDITORIA">4. Trilha de Auditoria e Logs (Individual)</option>
            <option value="ESCALAS">Escalas & Planner (Diário, Semanal, Mensal, Setor)</option>
            <option value="TANQUES">Cadastro de Bicos & Estoque de Tanques</option>
            <option value="FALTAS">Sobras, Faltas e Ocorrências de Caixa</option>
            <option value="CONFORMIDADE">Conformidade e Checklists Operacionais</option>
            <option value="FUNCIONARIOS">Quadro de Funcionários</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
            Filtro por Combustível
          </label>
          <select
            value={filtroCombustivel}
            onChange={(e) => setFiltroCombustivel(e.target.value)}
            className="w-full px-3 py-2 border border-blue-300 bg-blue-50/50 rounded-lg text-sm font-bold text-blue-900"
          >
            <option value="TODOS">⛽ Todos os Combustíveis</option>
            {listaCombustiveisDisponiveis.map((prod) => (
              <option key={prod} value={prod}>
                {prod}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Data Início</label>
          <input
            type="date"
            value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Data Fim</label>
          <input
            type="date"
            value={dataFim}
            onChange={(e) => setDataFim(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">Busca Rápida</label>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Operador, combustível, turno..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
        </div>
      </div>

      {/* Relatório Renderizado */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm print:shadow-none print:border-none space-y-6">
        <div className="pb-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h3 className="text-lg font-bold text-slate-900 uppercase">
              MEU POSTO 2.0 —{' '}
              {tipo === 'BALANCO_CONSOLIDADO'
                ? 'Balanço Consolidado de Fechamentos & Aferições'
                : tipo === 'AGRUPADO_COMBUSTIVEL'
                ? 'Relatório Consolidado Agrupado por Combustível'
                : `Relatório Operacional: ${tipo}`}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Período: <strong>{dataInicio}</strong> até <strong>{dataFim}</strong> • Emitido em:{' '}
              {new Date().toLocaleString('pt-BR')}
            </p>
          </div>
          <div className="text-right text-xs text-slate-400 font-mono">
            Documento Auditável • Nuvem 24h
          </div>
        </div>

        {/* MODO ESPECÍFICO 5 COLUNAS POR COMBUSTÍVEL */}
        {tipo === 'COMBUSTIVEL_5COL' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div>
                <h4 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Fuel className="w-5 h-5 text-teal-600" />
                  Relatório Simplificado por Combustível (5 Colunas Oficiais)
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Visualização padronizada: Combustível · Quantidade · Valor Unitário · Valor Total · Desvio
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleExportarCombustivel5ColunasPDF('MOBILE')}
                  disabled={gerandoPdf}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-xs font-bold transition shadow-xs cursor-pointer"
                  title="Exportar PDF formatado para celular (9:16) e WhatsApp"
                >
                  <Smartphone className="w-4 h-4" />
                  PDF Mobile (5 Colunas)
                </button>
                <button
                  onClick={() => handleExportarCombustivel5ColunasPDF('A4')}
                  disabled={gerandoPdf}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-bold transition shadow-xs cursor-pointer"
                  title="Exportar PDF no formato clássico A4"
                >
                  <FileDown className="w-4 h-4 text-blue-300" />
                  PDF A4
                </button>
              </div>
            </div>

            {/* Tabela das 5 Colunas */}
            <div className="overflow-x-auto bg-white border border-slate-200 rounded-xl shadow-xs">
              <ReportTable className="w-full text-xs text-left">
                <thead className="bg-slate-900 font-bold text-white uppercase text-[11px] tracking-wider">
                  <tr>
                    <th className="py-3.5 px-4 text-left">COMBUSTÍVEL</th>
                    <th className="py-3.5 px-4 text-right">QUANTIDADE</th>
                    <th className="py-3.5 px-4 text-right">VALOR UNITÁRIO</th>
                    <th className="py-3.5 px-4 text-right">VALOR TOTAL</th>
                    <th className="py-3.5 px-4 text-center">DESVIO</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {relatorioCombustiveis5Colunas.map((c) => (
                    <tr key={c.produto} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-slate-900 flex items-center gap-2">
                        <Fuel className="w-4 h-4 text-teal-600" />
                        <span className="text-sm">{c.produto}</span>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-800 text-sm">
                        {c.quantidade.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-slate-600 text-sm">
                        R$ {c.valorUnitario.toFixed(2)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-extrabold text-slate-900 text-sm">
                        {formatarMoeda(c.valorTotal)}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${
                            c.statusDesvio === 'FALTA'
                              ? 'bg-red-50 text-red-700 border border-red-200'
                              : c.statusDesvio === 'SOBRA'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {c.desvioTexto}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 font-bold text-slate-900 border-t-2 border-slate-300 text-xs">
                  <tr>
                    <td className="py-3.5 px-4 uppercase font-extrabold text-slate-800 text-sm">TOTAL GERAL</td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-900 font-extrabold text-sm">
                      {relatorioCombustiveis5Colunas
                        .reduce((s, c) => s + c.quantidade, 0)
                        .toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                      L
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-600 text-sm">
                      R${' '}
                      {(
                        relatorioCombustiveis5Colunas.reduce((s, c) => s + c.valorTotal, 0) /
                        Math.max(1, relatorioCombustiveis5Colunas.reduce((s, c) => s + c.quantidade, 0))
                      ).toFixed(2)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-900 font-extrabold text-base">
                      {formatarMoeda(relatorioCombustiveis5Colunas.reduce((s, c) => s + c.valorTotal, 0))}
                    </td>
                    <td className="py-3.5 px-4 text-center font-mono">
                      <span
                        className={`font-bold text-sm ${
                          relatorioCombustiveis5Colunas.reduce((s, c) => s + (c.desvioLitros || 0), 0) < 0
                            ? 'text-red-700'
                            : 'text-emerald-700'
                        }`}
                      >
                        {relatorioCombustiveis5Colunas.reduce((s, c) => s + (c.desvioLitros || 0), 0) > 0 ? '+' : ''}
                        {relatorioCombustiveis5Colunas
                          .reduce((s, c) => s + (c.desvioLitros || 0), 0)
                          .toFixed(2)}{' '}
                        L
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </ReportTable>
            </div>
          </div>
        )}

        {/* MODO AGRUPADO POR COMBUSTÍVEL */}
        {tipo === 'AGRUPADO_COMBUSTIVEL' && renderPainelAgrupadoPorCombustivel()}

        {/* MODO 1: BALANÇO CONSOLIDADO (FECHAMENTOS + AFERIÇÕES) */}
        {tipo === 'BALANCO_CONSOLIDADO' && (
          <div className="space-y-8">
            {/* Bloco 1: Resumo Financeiro de Fechamentos */}
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h4 className="text-sm font-bold text-slate-800 uppercase flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-blue-600" />
                  1. Balanço Financeiro de Fechamentos de Caixa ({balancoConsolidado.totalFechamentos} turnos)
                </h4>
                <span className="text-xs text-slate-500">
                  Conferência de bombas vs. valores recolhidos
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-[11px] font-bold uppercase text-slate-500">
                    Total Bombas (Conferido)
                  </div>
                  <div className="text-xl font-bold text-slate-900 font-mono mt-1">
                    {formatarMoeda(balancoConsolidado.totalConferido)}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    {balancoConsolidado.totalFechamentos} fechamento(s) no período
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-200">
                  <div className="text-[11px] font-bold uppercase text-blue-800">
                    Total Recolhido (Informado)
                  </div>
                  <div className="text-xl font-bold text-blue-950 font-mono mt-1">
                    {formatarMoeda(balancoConsolidado.totalInformado)}
                  </div>
                  <div className="text-[11px] text-blue-700 mt-1">
                    Soma de Pix, Cartões, Dinheiro e Notas
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-200">
                  <div className="text-[11px] font-bold uppercase text-emerald-800 flex items-center justify-between">
                    <span>Sobras Acumuladas</span>
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                  </div>
                  <div className="text-xl font-bold text-emerald-700 font-mono mt-1">
                    +{formatarMoeda(balancoConsolidado.totalSobras)}
                  </div>
                  <div className="text-[11px] text-emerald-700 mt-1">
                    Faltas: -{formatarMoeda(balancoConsolidado.totalFaltas)}
                  </div>
                </div>

                <div
                  className={`p-4 rounded-xl border ${
                    balancoConsolidado.saldoDiferenca < 0
                      ? 'bg-red-50/70 border-red-200'
                      : 'bg-emerald-50/70 border-emerald-200'
                  }`}
                >
                  <div className="text-[11px] font-bold uppercase text-slate-700 flex items-center justify-between">
                    <span>Saldo Líquido de Caixa</span>
                    {balancoConsolidado.saldoDiferenca < 0 ? (
                      <TrendingDown className="w-3.5 h-3.5 text-red-600" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    )}
                  </div>
                  <div
                    className={`text-xl font-bold font-mono mt-1 ${
                      balancoConsolidado.saldoDiferenca < 0 ? 'text-red-700' : 'text-emerald-800'
                    }`}
                  >
                    {formatarMoeda(balancoConsolidado.saldoDiferenca)}
                  </div>
                  <div className="text-[11px] text-slate-600 mt-1">
                    Resultado líquido (Informado - Conferido)
                  </div>
                </div>
              </div>

              {/* Composição por Meios de Pagamento */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">PIX Pista</span>
                  <strong className="font-mono text-slate-900">
                    {formatarMoeda(balancoConsolidado.meiosPagamento.pix)}
                  </strong>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">Cartões</span>
                  <strong className="font-mono text-slate-900">
                    {formatarMoeda(balancoConsolidado.meiosPagamento.cartao)}
                  </strong>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">
                    Dinheiro / Depósito
                  </span>
                  <strong className="font-mono text-slate-900">
                    {formatarMoeda(balancoConsolidado.meiosPagamento.deposito)}
                  </strong>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">Notas a Prazo</span>
                  <strong className="font-mono text-slate-900">
                    {formatarMoeda(balancoConsolidado.meiosPagamento.nota)}
                  </strong>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">PIX CNPJ</span>
                  <strong className="font-mono text-slate-900">
                    {formatarMoeda(balancoConsolidado.meiosPagamento.pixCnpj)}
                  </strong>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">Despesas</span>
                  <strong className="font-mono text-slate-900">
                    {formatarMoeda(balancoConsolidado.meiosPagamento.despesa)}
                  </strong>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">Outros</span>
                  <strong className="font-mono text-slate-900">
                    {formatarMoeda(balancoConsolidado.meiosPagamento.outros)}
                  </strong>
                </div>
              </div>

              {/* Tabela de Fechamentos no Balanço Consolidado */}
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <ReportTable className="w-full text-xs text-left">
                  <thead className="bg-slate-100 border-b border-slate-200 font-bold text-slate-700 uppercase">
                    <tr>
                      <th className="py-2.5 px-3">Data / Turno</th>
                      <th className="py-2.5 px-3">Operador / Caixa</th>
                      <th className="py-2.5 px-3">Total Bombas</th>
                      <th className="py-2.5 px-3">Total Informado</th>
                      <th className="py-2.5 px-3">Diferença</th>
                      <th className="py-2.5 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {fechamentosFiltrados.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-slate-400">
                          Nenhum fechamento de caixa encontrado no período selecionado.
                        </td>
                      </tr>
                    ) : (
                      fechamentosFiltrados.map((f) => (
                        <tr key={f.id} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-mono font-semibold">
                            {f.data} ({f.turno})
                          </td>
                          <td className="py-2 px-3 font-medium text-slate-900">
                            {f.funcionarioNome || 'Operador'}
                          </td>
                          <td className="py-2 px-3 font-mono">{formatarMoeda(f.totalConferido)}</td>
                          <td className="py-2 px-3 font-mono font-bold">
                            {formatarMoeda(f.totalInformado)}
                          </td>
                          <td className="py-2 px-3 font-mono font-bold">
                            <span className={f.diferenca < 0 ? 'text-red-600' : 'text-emerald-600'}>
                              {formatarMoeda(f.diferenca)}
                            </span>
                          </td>
                          <td className="py-2 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                f.diferenca < 0
                                  ? 'bg-red-100 text-red-800'
                                  : f.diferenca > 0
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {f.tipoDiferenca}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </ReportTable>
              </div>
            </div>

            {/* Bloco 2: Resumo Metrológico de Aferições */}
            {renderPainelAfericoesCompleto()}

            {/* Bloco 3: Resumo de Análises Físico-Químicas & Qualidade ANP */}
            <div className="space-y-4 pt-2">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h4 className="text-sm font-bold text-slate-800 uppercase flex items-center gap-2">
                  <FlaskConical className="w-4 h-4 text-purple-600" />
                  3. Balanço de Qualidade & Conformidade Regulatória ANP ({balancoConsolidado.totalAnalises} ensaios)
                </h4>
                <span className="text-xs text-slate-500">
                  Norma NBR 5992 • Proveta, Termodensímetro e Teor Alcoólico
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-[11px] font-bold uppercase text-slate-500">
                    Total de Ensaios
                  </div>
                  <div className="text-xl font-bold text-slate-900 font-mono mt-1">
                    {balancoConsolidado.totalAnalises}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Gasolina, Etanol e Diesel
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-purple-50/60 border border-purple-200">
                  <div className="text-[11px] font-bold uppercase text-purple-800 flex items-center justify-between">
                    <span>Índice de Qualidade</span>
                    <CheckCircle2 className="w-3.5 h-3.5 text-purple-600" />
                  </div>
                  <div className="text-xl font-bold text-purple-900 font-mono mt-1">
                    {balancoConsolidado.taxaConformidadeAnalises}%
                  </div>
                  <div className="text-[11px] text-purple-700 mt-1">
                    {balancoConsolidado.analisesConformes} amostras aprovadas
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-200">
                  <div className="text-[11px] font-bold uppercase text-emerald-800">
                    Amostras Conformes
                  </div>
                  <div className="text-xl font-bold text-emerald-700 font-mono mt-1">
                    {balancoConsolidado.analisesConformes}
                  </div>
                  <div className="text-[11px] text-emerald-700 mt-1">
                    Dentro dos padrões ANP
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-amber-50/60 border border-amber-200">
                  <div className="text-[11px] font-bold uppercase text-amber-900 flex items-center justify-between">
                    <span>Fora da Faixa ANP</span>
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                  </div>
                  <div className="text-xl font-bold text-amber-900 font-mono mt-1">
                    {balancoConsolidado.analisesNaoConformes}
                  </div>
                  <div className="text-[11px] text-amber-800 mt-1">
                    Exige contraprova ou bloqueio
                  </div>
                </div>
              </div>

              {/* Tabela de Análises no Balanço Consolidado */}
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <ReportTable className="w-full text-xs text-left">
                  <thead className="bg-slate-100 border-b border-slate-200 font-bold text-slate-700 uppercase">
                    <tr>
                      <th className="py-2.5 px-3">Data / Hora</th>
                      <th className="py-2.5 px-3">Combustível</th>
                      <th className="py-2.5 px-3">Ensaio / Teste</th>
                      <th className="py-2.5 px-3">Densidade Lida</th>
                      <th className="py-2.5 px-3">Temp (°C)</th>
                      <th className="py-2.5 px-3">Densidade 20°C</th>
                      <th className="py-2.5 px-3">Faixa Permitida</th>
                      <th className="py-2.5 px-3">Teor / Parâmetro</th>
                      <th className="py-2.5 px-3">Laudo ANP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {analisesFiltradas.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-6 text-center text-slate-400">
                          Nenhuma análise físico-química registrada no período selecionado.
                        </td>
                      </tr>
                    ) : (
                      analisesFiltradas.map((d) => {
                        const tempVal = d.temperatura ?? (d as any).temperaturaC ?? 20;
                        const densObs =
                          typeof d.densidadeObservada === 'number'
                            ? d.densidadeObservada.toFixed(4)
                            : String(d.densidadeObservada || '—');
                        const dens20 =
                          typeof d.densidadeCalculada20C === 'number'
                            ? d.densidadeCalculada20C.toFixed(4)
                            : typeof d.densidadeObservada === 'number'
                            ? d.densidadeObservada.toFixed(4)
                            : '—';
                        const faixa =
                          d.densidadeReferenciaMin && d.densidadeReferenciaMax
                            ? `${d.densidadeReferenciaMin.toFixed(3)} - ${d.densidadeReferenciaMax.toFixed(3)}`
                            : 'Faixa ANP';
                        const paramExtra = d.teorEtanolAnidro
                          ? `${d.teorEtanolAnidro}% Etanol`
                          : (d as any).teorAlcoolico !== undefined
                          ? `${(d as any).teorAlcoolico}% Etanol`
                          : d.condutividadeEletrica
                          ? `${d.condutividadeEletrica} µS/m`
                          : d.ph
                          ? `pH ${d.ph}`
                          : '—';
                        const laudo = d.resultado || (d as any).status || 'CONFORME';

                        return (
                          <tr key={d.id} className="hover:bg-slate-50">
                            <td className="py-2 px-3 font-mono">
                              {d.data} {d.hora}
                            </td>
                            <td className="py-2 px-3 font-medium text-slate-900">{d.produto}</td>
                            <td className="py-2 px-3">
                              {(d.tipoTeste || 'DENSIDADE_D20').replace(/_/g, ' ')}
                            </td>
                            <td className="py-2 px-3 font-mono">{densObs}</td>
                            <td className="py-2 px-3 font-mono">{tempVal} °C</td>
                            <td className="py-2 px-3 font-mono font-bold">{dens20}</td>
                            <td className="py-2 px-3 font-mono text-[11px] text-slate-500">{faixa}</td>
                            <td className="py-2 px-3 font-mono text-purple-700">{paramExtra}</td>
                            <td className="py-2 px-3">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  laudo === 'CONFORME'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-red-100 text-red-800'
                                }`}
                              >
                                {laudo}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </ReportTable>
              </div>
            </div>

            {/* Bloco 4: Resumo de Auditoria & Trilha de Segurança */}
            <div className="space-y-4 pt-2">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h4 className="text-sm font-bold text-slate-800 uppercase flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-blue-600" />
                  4. Trilha de Auditoria & Segurança Operacional ({balancoConsolidado.totalAuditoria} registros)
                </h4>
                <span className="text-xs text-slate-500">
                  Logs auditáveis 24h em Nuvem • Imutabilidade e Rastreabilidade
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-[11px] font-bold uppercase text-slate-500">
                    Total de Eventos Auditados
                  </div>
                  <div className="text-xl font-bold text-slate-900 font-mono mt-1">
                    {balancoConsolidado.totalAuditoria}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Operações registradas no período
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-200">
                  <div className="text-[11px] font-bold uppercase text-blue-800">
                    Módulos Impactados
                  </div>
                  <div className="text-xl font-bold text-blue-950 font-mono mt-1">
                    {balancoConsolidado.modulosAuditoriaQtd}
                  </div>
                  <div className="text-[11px] text-blue-700 mt-1">
                    Caixa, Bicos, Tanques, Escalas
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-200">
                  <div className="text-[11px] font-bold uppercase text-emerald-800">
                    Usuários Identificados
                  </div>
                  <div className="text-xl font-bold text-emerald-700 font-mono mt-1">
                    {balancoConsolidado.usuariosAuditoriaQtd}
                  </div>
                  <div className="text-[11px] text-emerald-700 mt-1">
                    Identificação de operadores
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-100 border border-slate-300">
                  <div className="text-[11px] font-bold uppercase text-slate-700 flex items-center justify-between">
                    <span>Integridade da Trilha</span>
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  </div>
                  <div className="text-base font-bold text-emerald-700 mt-1">
                    100% Criptografado
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Logs rastreados em tempo real
                  </div>
                </div>
              </div>

              {/* Tabela de Auditoria no Balanço Consolidado */}
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <ReportTable className="w-full text-xs text-left">
                  <thead className="bg-slate-100 border-b border-slate-200 font-bold text-slate-700 uppercase">
                    <tr>
                      <th className="py-2.5 px-3">Data / Hora</th>
                      <th className="py-2.5 px-3">Usuário Responsável</th>
                      <th className="py-2.5 px-3">Módulo</th>
                      <th className="py-2.5 px-3">Entidade</th>
                      <th className="py-2.5 px-3">Ação Executada</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {auditoriaFiltrada.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-slate-400">
                          Nenhum evento de auditoria registrado no período selecionado.
                        </td>
                      </tr>
                    ) : (
                      auditoriaFiltrada.slice(0, 50).map((l) => (
                        <tr key={l.id} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-mono text-[11px]">
                            {l.timestamp ? new Date(l.timestamp).toLocaleString('pt-BR') : '—'}
                          </td>
                          <td className="py-2 px-3 font-medium text-slate-900">
                            {l.usuarioNome || 'Operador'}
                          </td>
                          <td className="py-2 px-3">{l.modulo || 'Geral'}</td>
                          <td className="py-2 px-3 font-mono text-slate-600">{l.entidade || 'Sistema'}</td>
                          <td className="py-2 px-3">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-800 border border-blue-200">
                              {l.acao || 'REGISTRO'}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </ReportTable>
              </div>
            </div>
          </div>
        )}

        {/* Relatório Completo de Escalas e Planner */}
        {tipo === 'ESCALAS' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 p-3 rounded-lg border border-slate-200 print:hidden">
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: 'DIARIO', label: 'Relatório Diário' },
                    { id: 'SEMANAL', label: 'Relatório Semanal' },
                    { id: 'MENSAL', label: 'Relatório Mensal' },
                    { id: 'FUNCIONARIO', label: 'Por Funcionário' },
                    { id: 'SETOR', label: 'Por Setor' },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSubModoEscala(m.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                      subModoEscala === m.id
                        ? 'bg-purple-600 text-white'
                        : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <select
                  value={filtroFuncRelatorio}
                  onChange={(e) => setFiltroFuncRelatorio(e.target.value)}
                  className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-semibold"
                >
                  <option value="TODOS">Todos os Funcionários</option>
                  {funcionarios.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                    </option>
                  ))}
                </select>

                <select
                  value={filtroSetorRelatorio}
                  onChange={(e) => setFiltroSetorRelatorio(e.target.value)}
                  className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-semibold"
                >
                  <option value="TODOS">Todos os Setores</option>
                  <option value="Pista">Pista</option>
                  <option value="Caixa">Caixa</option>
                  <option value="Conveniência">Conveniência</option>
                  <option value="Lubrificação">Lubrificação</option>
                  <option value="Gerência">Gerência</option>
                </select>
              </div>
            </div>

            <div className="text-xs font-bold text-slate-600 uppercase">
              Modalidade Selecionada: {subModoEscala} ({escalasFiltradas.length} registros)
            </div>

            <ReportTable className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-100 border-b border-slate-200 font-bold text-slate-700 uppercase">
                <tr>
                  <th className="py-2.5 px-3">Funcionário</th>
                  <th className="py-2.5 px-3">Data / Dia</th>
                  <th className="py-2.5 px-3">Entrada</th>
                  <th className="py-2.5 px-3">Saída</th>
                  <th className="py-2.5 px-3">Intervalo</th>
                  <th className="py-2.5 px-3">Turno</th>
                  <th className="py-2.5 px-3">Setor / Função</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Observações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {escalasFiltradas.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="py-2 px-3 font-bold text-slate-900">{e.funcionarioNome}</td>
                    <td className="py-2 px-3 font-mono">
                      {e.data} {e.diaSemana ? `(${e.diaSemana})` : ''}
                    </td>
                    <td className="py-2 px-3 font-mono font-semibold">{e.horarioInicio}</td>
                    <td className="py-2 px-3 font-mono font-semibold">{e.horarioFim}</td>
                    <td className="py-2 px-3">{e.intervalo || '1h'}</td>
                    <td className="py-2 px-3">{e.turno}</td>
                    <td className="py-2 px-3">
                      {e.setor || 'Pista'} • {e.funcao || 'Frentista'}
                    </td>
                    <td className="py-2 px-3 font-bold">{e.status}</td>
                    <td className="py-2 px-3 text-slate-500">{e.observacao || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </ReportTable>
          </div>
        )}

        {/* Relatório de Cadastro de Bicos e Tanques */}
        {tipo === 'TANQUES' && (
          <div className="space-y-4">
            <h4 className="text-xs font-bold uppercase text-slate-700">
              Tanques Cadastrados ({tanques.length})
            </h4>
            <ReportTable className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-50 border-b font-semibold text-slate-700 uppercase">
                <tr>
                  
                  <th className="py-2 px-3">Combustível</th>
                  
                  <th className="py-2 px-3">Estoque Atual</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tanques.map((t) => (
                  <tr key={t.id}>
                    
                    <td className="py-2 px-3">{t.produto}</td>
                    
                    <td className="py-2 px-3 font-mono font-bold">
                      {t.volumeAtual.toLocaleString('pt-BR')} L
                    </td>
                  </tr>
                ))}
              </tbody>
            </ReportTable>

            <h4 className="text-xs font-bold uppercase text-slate-700 pt-2">
              Bicos Cadastrados ({bicos.length})
            </h4>
            <ReportTable className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-50 border-b font-semibold text-slate-700 uppercase">
                <tr>
                  <th className="py-2 px-3">Bico</th>
                  <th className="py-2 px-3">Combustível</th>
                  <th className="py-2 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bicos.map((b) => (
                  <tr key={b.id}>
                    <td className="py-2 px-3 font-bold">
                      Bico {String(b.numero).padStart(2, '0')}
                    </td>
                    <td className="py-2 px-3">{b.produto}</td>
                    <td className="py-2 px-3 font-bold">{b.status}</td>
                  </tr>
                ))}
              </tbody>
            </ReportTable>
          </div>
        )}

        {/* Tabela de Fechamentos */}
        {tipo === 'FECHAMENTOS' && (
          <ReportTable className="w-full text-xs text-left">
            <thead className="bg-slate-50 border-b font-semibold text-slate-700 uppercase">
              <tr>
                <th className="py-2.5 px-3">Data / Turno</th>
                <th className="py-2.5 px-3">Operador / Caixa</th>
                <th className="py-2.5 px-3">Informado</th>
                <th className="py-2.5 px-3">Conferido</th>
                <th className="py-2.5 px-3">Diferença</th>
                <th className="py-2.5 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fechamentosFiltrados.map((f) => (
                <tr key={f.id}>
                  <td className="py-2 px-3">
                    {f.data} ({f.turno})
                  </td>
                  <td className="py-2 px-3">{f.funcionarioNome}</td>
                  <td className="py-2 px-3 font-mono">{formatarMoeda(f.totalInformado)}</td>
                  <td className="py-2 px-3 font-mono font-bold">{formatarMoeda(f.totalConferido)}</td>
                  <td className="py-2 px-3 font-mono font-bold">
                    <span className={f.diferenca < 0 ? 'text-red-600' : 'text-emerald-600'}>
                      {formatarMoeda(f.diferenca)}
                    </span>
                  </td>
                  <td className="py-2 px-3">{f.tipoDiferenca}</td>
                </tr>
              ))}
            </tbody>
          </ReportTable>
        )}

        {/* Relatório Completo de Aferições de Bicos */}
        {tipo === 'AFERICOES' && renderPainelAfericoesCompleto()}

        {/* Tabela de Faltas e Ocorrências */}
        {tipo === 'FALTAS' && (
          <ReportTable className="w-full text-xs text-left">
            <thead className="bg-slate-50 border-b font-semibold text-slate-700 uppercase">
              <tr>
                <th className="py-2.5 px-3">Data</th>
                <th className="py-2.5 px-3">Colaborador</th>
                <th className="py-2.5 px-3">Tipo</th>
                <th className="py-2.5 px-3">Valor</th>
                <th className="py-2.5 px-3">Motivo</th>
                <th className="py-2.5 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ocorrencias.map((o) => (
                <tr key={o.id}>
                  <td className="py-2 px-3 font-mono">{o.data}</td>
                  <td className="py-2 px-3 font-medium">{o.funcionarioNome}</td>
                  <td className="py-2 px-3">{o.tipo}</td>
                  <td className="py-2 px-3 font-mono font-bold">{formatarMoeda(o.valor)}</td>
                  <td className="py-2 px-3">{o.motivo}</td>
                  <td className="py-2 px-3 font-bold">{o.status}</td>
                </tr>
              ))}
            </tbody>
          </ReportTable>
        )}

        {/* Tabela de Densidades / Análises */}
        {(tipo === 'DENSIDADES' || tipo === 'ANALISES') && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-[11px] font-bold uppercase text-slate-500">
                  Total de Ensaios
                </div>
                <div className="text-xl font-bold text-slate-900 font-mono mt-1">
                  {balancoConsolidado.totalAnalises}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Amostras no período selecionado
                </div>
              </div>

              <div className="p-4 rounded-xl bg-purple-50/60 border border-purple-200">
                <div className="text-[11px] font-bold uppercase text-purple-800 flex items-center justify-between">
                  <span>Taxa de Conformidade</span>
                  <CheckCircle2 className="w-3.5 h-3.5 text-purple-600" />
                </div>
                <div className="text-xl font-bold text-purple-900 font-mono mt-1">
                  {balancoConsolidado.taxaConformidadeAnalises}%
                </div>
                <div className="text-[11px] text-purple-700 mt-1">
                  {balancoConsolidado.analisesConformes} amostras conformes
                </div>
              </div>

              <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-200">
                <div className="text-[11px] font-bold uppercase text-emerald-800">
                  Aprovadas ANP
                </div>
                <div className="text-xl font-bold text-emerald-700 font-mono mt-1">
                  {balancoConsolidado.analisesConformes}
                </div>
                <div className="text-[11px] text-emerald-700 mt-1">
                  Dentro das faixas oficiais
                </div>
              </div>

              <div className="p-4 rounded-xl bg-amber-50/60 border border-amber-200">
                <div className="text-[11px] font-bold uppercase text-amber-900 flex items-center justify-between">
                  <span>Fora de Faixa</span>
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                </div>
                <div className="text-xl font-bold text-amber-900 font-mono mt-1">
                  {balancoConsolidado.analisesNaoConformes}
                </div>
                <div className="text-[11px] text-amber-800 mt-1">
                  Exigem contraprova imediata
                </div>
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <ReportTable className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b font-semibold text-slate-700 uppercase">
                  <tr>
                    <th className="py-2.5 px-3">Data / Hora</th>
                    <th className="py-2.5 px-3">Combustível</th>
                    <th className="py-2.5 px-3">Ensaio / Teste</th>
                    <th className="py-2.5 px-3">Densidade Lida</th>
                    <th className="py-2.5 px-3">Temp (°C)</th>
                    <th className="py-2.5 px-3">Densidade 20°C</th>
                    <th className="py-2.5 px-3">Faixa ANP</th>
                    <th className="py-2.5 px-3">Teor / Parâmetro</th>
                    <th className="py-2.5 px-3">Laudo ANP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {analisesFiltradas.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-6 text-center text-slate-400">
                        Nenhuma análise de qualidade encontrada no período selecionado.
                      </td>
                    </tr>
                  ) : (
                    analisesFiltradas.map((d) => {
                      const tempVal = d.temperatura ?? (d as any).temperaturaC ?? 20;
                      const densObs =
                        typeof d.densidadeObservada === 'number'
                          ? d.densidadeObservada.toFixed(4)
                          : String(d.densidadeObservada || '—');
                      const dens20 =
                        typeof d.densidadeCalculada20C === 'number'
                          ? d.densidadeCalculada20C.toFixed(4)
                          : typeof d.densidadeObservada === 'number'
                          ? d.densidadeObservada.toFixed(4)
                          : '—';
                      const faixa =
                        d.densidadeReferenciaMin && d.densidadeReferenciaMax
                          ? `${d.densidadeReferenciaMin.toFixed(3)} - ${d.densidadeReferenciaMax.toFixed(3)}`
                          : 'Faixa ANP';
                      const paramExtra = d.teorEtanolAnidro
                        ? `${d.teorEtanolAnidro}% Etanol`
                        : (d as any).teorAlcoolico !== undefined
                        ? `${(d as any).teorAlcoolico}% Etanol`
                        : d.condutividadeEletrica
                        ? `${d.condutividadeEletrica} µS/m`
                        : d.ph
                        ? `pH ${d.ph}`
                        : '—';
                      const laudo = d.resultado || (d as any).status || 'CONFORME';

                      return (
                        <tr key={d.id} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-mono">
                            {d.data} {d.hora}
                          </td>
                          <td className="py-2 px-3 font-medium text-slate-900">{d.produto}</td>
                          <td className="py-2 px-3">
                            {(d.tipoTeste || 'DENSIDADE_D20').replace(/_/g, ' ')}
                          </td>
                          <td className="py-2 px-3 font-mono">{densObs}</td>
                          <td className="py-2 px-3 font-mono">{tempVal} °C</td>
                          <td className="py-2 px-3 font-mono font-bold">{dens20}</td>
                          <td className="py-2 px-3 font-mono text-[11px] text-slate-500">{faixa}</td>
                          <td className="py-2 px-3 font-mono text-purple-700">{paramExtra}</td>
                          <td className="py-2 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                laudo === 'CONFORME'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-red-100 text-red-800'
                              }`}
                            >
                              {laudo}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </ReportTable>
            </div>
          </div>
        )}

        {/* Tabela de Conformidade */}
        {tipo === 'CONFORMIDADE' && (
          <ReportTable className="w-full text-xs text-left">
            <thead className="bg-slate-50 border-b font-semibold text-slate-700 uppercase">
              <tr>
                <th className="py-2.5 px-3">Data</th>
                <th className="py-2.5 px-3">Categoria</th>
                <th className="py-2.5 px-3">Item</th>
                <th className="py-2.5 px-3">Responsável</th>
                <th className="py-2.5 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {conformidades.map((c) => (
                <tr key={c.id}>
                  <td className="py-2 px-3 font-mono">{c.dataVerificacao}</td>
                  <td className="py-2 px-3">{c.categoria}</td>
                  <td className="py-2 px-3 font-medium">{c.item}</td>
                  <td className="py-2 px-3">{c.responsavel}</td>
                  <td className="py-2 px-3 font-bold">{c.status}</td>
                </tr>
              ))}
            </tbody>
          </ReportTable>
        )}

        {/* Tabela de Funcionários */}
        {tipo === 'FUNCIONARIOS' && (
          <ReportTable className="w-full text-xs text-left">
            <thead className="bg-slate-50 border-b font-semibold text-slate-700 uppercase">
              <tr>
                <th className="py-2.5 px-3">Nome</th>
                <th className="py-2.5 px-3">Matrícula</th>
                <th className="py-2.5 px-3">Cargo / Função</th>
                <th className="py-2.5 px-3">Turno Preferencial</th>
                <th className="py-2.5 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {funcionarios.map((f) => (
                <tr key={f.id}>
                  <td className="py-2 px-3 font-bold">{f.nome}</td>
                  <td className="py-2 px-3 font-mono">{f.matricula}</td>
                  <td className="py-2 px-3">
                    {f.cargo} • {f.funcao}
                  </td>
                  <td className="py-2 px-3">{f.turnoPreferencial}</td>
                  <td className="py-2 px-3 font-bold">{f.status}</td>
                </tr>
              ))}
            </tbody>
          </ReportTable>
        )}

        {/* Tabela de Auditoria */}
        {tipo === 'AUDITORIA' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-[11px] font-bold uppercase text-slate-500">
                  Total de Eventos
                </div>
                <div className="text-xl font-bold text-slate-900 font-mono mt-1">
                  {balancoConsolidado.totalAuditoria}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Ações registradas no período
                </div>
              </div>

              <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-200">
                <div className="text-[11px] font-bold uppercase text-blue-800">
                  Módulos Impactados
                </div>
                <div className="text-xl font-bold text-blue-950 font-mono mt-1">
                  {balancoConsolidado.modulosAuditoriaQtd}
                </div>
                <div className="text-[11px] text-blue-700 mt-1">
                  Caixa, Bicos, Tanques, Escalas
                </div>
              </div>

              <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-200">
                <div className="text-[11px] font-bold uppercase text-emerald-800">
                  Usuários Identificados
                </div>
                <div className="text-xl font-bold text-emerald-700 font-mono mt-1">
                  {balancoConsolidado.usuariosAuditoriaQtd}
                </div>
                <div className="text-[11px] text-emerald-700 mt-1">
                  Rastreabilidade nominal
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-100 border border-slate-300">
                <div className="text-[11px] font-bold uppercase text-slate-700 flex items-center justify-between">
                  <span>Trilha Segura</span>
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                </div>
                <div className="text-base font-bold text-emerald-700 mt-1">
                  100% Criptografado
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Histórico inalterável em Nuvem
                </div>
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <ReportTable className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b font-semibold text-slate-700 uppercase">
                  <tr>
                    <th className="py-2.5 px-3">Data / Hora</th>
                    <th className="py-2.5 px-3">Usuário Responsável</th>
                    <th className="py-2.5 px-3">Módulo Operacional</th>
                    <th className="py-2.5 px-3">Entidade Afetada</th>
                    <th className="py-2.5 px-3">Ação Executada</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditoriaFiltrada.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-400">
                        Nenhum registro de auditoria encontrado no período selecionado.
                      </td>
                    </tr>
                  ) : (
                    auditoriaFiltrada.map((l) => (
                      <tr key={l.id} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-mono text-[11px]">
                          {l.timestamp ? new Date(l.timestamp).toLocaleString('pt-BR') : '—'}
                        </td>
                        <td className="py-2 px-3 font-medium text-slate-900">{l.usuarioNome || 'Operador'}</td>
                        <td className="py-2 px-3">{l.modulo || 'Geral'}</td>
                        <td className="py-2 px-3 font-mono text-slate-600">{l.entidade || 'Sistema'}</td>
                        <td className="py-2 px-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-800 border border-blue-200">
                            {l.acao || 'REGISTRO'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </ReportTable>
            </div>
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
};
