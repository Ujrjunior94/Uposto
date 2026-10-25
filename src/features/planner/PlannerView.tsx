import { normalizarTextoComparacao, normalizarTurnoPreferencialCadastro } from '../../services/geminiOcrService';
import React, { useState, useMemo, useRef } from 'react';
import { Funcionario, Escala, EscalaStatus, FuncionarioStatus, EscalaImportada } from '../../types';
import { PostoSubcollectionRepository, registrarAuditoria } from '../../repositories/firestoreRepository';
import { useAuth } from '../../contexts/AuthContext';
import { PainelVisualizacoesPlanner, ModoVisaoPlanner } from './PainelVisualizacoesPlanner';

import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  Sparkles,
  Plus,
  Copy,
  Zap,
  Printer,
  Camera,
  Upload,
  Link2,
  Trash2,
  Edit2,
  X,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  Users,
  Undo2,
} from 'lucide-react';
import {
  analisarConflitosEscala,
  ConfiguracaoRegrasEscala,
  REGRAS_PADRAO_ESCALA,
  ConflitoEscala,
} from './detectorConflitosEscala';
import { PainelConflitosEscala } from './PainelConflitosEscala';
import { ModalImportarEscalaImagem } from './ModalImportarEscalaImagem';
import {
  desfazerUltimaImportacao,
  obterUltimoSnapshotImportacao,
} from './importadorEscalaImagemService';

const repoEscala = new PostoSubcollectionRepository<Escala>('escalas');
const repoFunc = new PostoSubcollectionRepository<Funcionario>('funcionarios');

export const TURNOS_OFICIAIS = [
  {
    id: 'Turno 1 - Manhã (06h - 14h)',
    sigla: 'T1',
    nomeCurto: 'Turno 1 (Manhã)',
    inicio: '06:00',
    fim: '14:00',
    corBadge: 'bg-amber-100 text-amber-900 border-amber-300',
  },
  {
    id: 'Turno 2 - Tarde (14h - 22h)',
    sigla: 'T2',
    nomeCurto: 'Turno 2 (Tarde)',
    inicio: '14:00',
    fim: '22:00',
    corBadge: 'bg-blue-100 text-blue-900 border-blue-300',
  },
  {
    id: 'Turno Horista',
    sigla: 'HOR',
    nomeCurto: 'Turno Horista',
    inicio: '08:00',
    fim: '14:00',
    corBadge: 'bg-teal-100 text-teal-900 border-teal-300',
  },
  {
    id: 'Turno ADM (08h - 17h)',
    sigla: 'ADM',
    nomeCurto: 'Turno ADM (Administrativo)',
    inicio: '08:00',
    fim: '17:00',
    corBadge: 'bg-indigo-100 text-indigo-900 border-indigo-300',
  },
  {
    id: 'Folga',
    sigla: 'FOL',
    nomeCurto: 'Folga (DSR)',
    inicio: '00:00',
    fim: '00:00',
    corBadge: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  },
  {
    id: 'Férias',
    sigla: 'FER',
    nomeCurto: 'Férias',
    inicio: '00:00',
    fim: '00:00',
    corBadge: 'bg-orange-100 text-orange-900 border-orange-300',
  },
];

interface PlannerProps {
  funcionarios: Funcionario[];
  escalas: Escala[];
  escalasImportadas?: EscalaImportada[];
  onReload: () => void;
  onNavigateToIAEscala?: () => void;
}

interface LinhaEscaneada {
  idTemp: string;
  nomeNaImagem: string;
  cargoSugerido: string;
  setorSugerido: string;
  turnoPrincipal: string;
  siglaTurnoPrincipal: string;
  horarioInicioPadrao: string;
  horarioFimPadrao: string;
  funcionarioIdVinculado: string; // '' = criar novo funcionário
  dias: Record<
    number,
    {
      status: EscalaStatus;
      turno: string;
      sigla: string; // 'T1', 'T2', 'T3', 'HOR', 'PLT', 'S', 'FE', 'AT'
      horarioInicio: string;
      horarioFim: string;
    }
  >;
}

export const PlannerView: React.FC<PlannerProps> = ({
  funcionarios,
  escalas,
  escalasImportadas = [],
  onReload,
  onNavigateToIAEscala,
}) => {
  const { postoId, userProfile } = useAuth();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedTurnoFiltro, setSelectedTurnoFiltro] = useState<string>('TODOS');
  const [modoVisao, setModoVisao] = useState<ModoVisaoPlanner>('MENSAL');
  const [buscaTexto, setBuscaTexto] = useState<string>('');
  const [filtroSetor, setFiltroSetor] = useState<string>('TODOS');
  const [salvandoAuto, setSalvandoAuto] = useState(false);

  // Configuração e Auditoria Automática de Conflitos na Escala (CLT, Interjornadas e Cobertura)
  const [configRegras, setConfigRegras] = useState<ConfiguracaoRegrasEscala>(() => {
    try {
      const saved = localStorage.getItem('planner_regras_escala');
      if (saved) return JSON.parse(saved);
    } catch {}
    return REGRAS_PADRAO_ESCALA;
  });
  const [destacarConflitosNaGrade, setDestacarConflitosNaGrade] = useState<boolean>(true);
  const [filtrarApenasComConflito, setFiltrarApenasComConflito] = useState<boolean>(false);

  // Modo Edição Rápida vs Abrir Modal de Edição/Exclusão ao clicar na célula
  const [modoRapido, setModoRapido] = useState(false);
  const [pincelStatus, setPincelStatus] = useState<
    'T1_MANHA' | 'T2_TARDE' | 'HORISTA' | 'ADM' | 'FOLGA' | 'FERIAS' | 'T3_NOITE' | 'ATESTADO' | 'AUSENTE'
  >('FOLGA');

  // Modal de edição/exclusão de célula individual da escala
  const [celulaEditando, setCelulaEditando] = useState<{
    func: Funcionario;
    day: number;
    dateStr: string;
    escalaExistente?: Escala;
  } | null>(null);
  const [modalStatus, setModalStatus] = useState<EscalaStatus>('TRABALHO');
  const [modalTurno, setModalTurno] = useState<string>('Turno 1 - Manhã (06h - 14h)');
  const [modalInicio, setModalInicio] = useState<string>('06:00');
  const [modalFim, setModalFim] = useState<string>('14:00');
  const [modalIntervalo, setModalIntervalo] = useState<string>('1h (Intrajornada)');
  const [modalSetor, setModalSetor] = useState<string>('Pista');
  const [modalFuncao, setModalFuncao] = useState<string>('Frentista');
  const [modalObs, setModalObs] = useState<string>('');

  // Modal de Alterar / Excluir Funcionário direto pelo Planner
  const [funcEditando, setFuncEditando] = useState<Funcionario | null>(null);
  const [editNome, setEditNome] = useState('');
  const [editCargo, setEditCargo] = useState('Frentista');
  const [editTurnoPref, setEditTurnoPref] = useState('Turno 1 - Manhã (06h - 14h)');
  const [editStatusFunc, setEditStatusFunc] = useState<FuncionarioStatus>('ATIVO');

  // Modal Importar Escala por Imagem Oficial com Validação Estrita (Posto ADM)
  const [modalImportarImagemAberto, setModalImportarImagemAberto] = useState(false);
  const [mensagemUndo, setMensagemUndo] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  const [desfazendoImportacao, setDesfazendoImportacao] = useState(false);

  const handleDesfazerUltimaImportacao = async () => {
    if (!postoId) return;
    const snap = obterUltimoSnapshotImportacao();
    if (!snap) {
      setMensagemUndo({
        tipo: 'erro',
        texto: 'Nenhum histórico de importação recente encontrado para desfazer.',
      });
      setTimeout(() => setMensagemUndo(null), 5000);
      return;
    }

    if (!window.confirm('Deseja realmente desfazer a última importação de escala e restaurar o estado anterior?')) {
      return;
    }

    setDesfazendoImportacao(true);
    try {
      const res = await desfazerUltimaImportacao(postoId, repoEscala);
      if (res.success) {
        setMensagemUndo({ tipo: 'sucesso', texto: res.message });
        await onReload();
      } else {
        setMensagemUndo({ tipo: 'erro', texto: res.message });
      }
    } catch (err: any) {
      setMensagemUndo({ tipo: 'erro', texto: `Falha ao desfazer: ${err?.message || 'Erro inesperado'}` });
    } finally {
      setDesfazendoImportacao(false);
      setTimeout(() => setMensagemUndo(null), 6000);
    }
  };

  const [limpandoPlanner, setLimpandoPlanner] = useState(false);

  const handleLimparPlannerMes = async () => {
    const escalasMesAtual = escalas.filter((e) => e.data && e.data.startsWith(mesAnoStr));
    if (escalasMesAtual.length === 0) {
      setMensagemUndo({ tipo: 'erro', texto: 'Não há registros de escala neste mês para limpar.' });
      setTimeout(() => setMensagemUndo(null), 5000);
      return;
    }
    const confirmado = window.confirm(
      `Deseja realmente limpar todos os ${escalasMesAtual.length} registros de escala do mês ${monthName}? Esta ação excluirá permanentemente os lançamentos deste mês.`
    );
    if (!confirmado) return;

    setLimpandoPlanner(true);
    try {
      const idsParaExcluir = escalasMesAtual.map((e) => e.id);
      await repoEscala.deleteBatch(postoId, idsParaExcluir);
      setMensagemUndo({
        tipo: 'sucesso',
        texto: `Escala do mês ${monthName} limpa com sucesso (${idsParaExcluir.length} registros removidos).`,
      });
      await onReload();
    } catch (err: any) {
      setMensagemUndo({
        tipo: 'erro',
        texto: `Erro ao limpar Planner: ${err?.message || 'Falha na operação'}`,
      });
    } finally {
      setLimpandoPlanner(false);
      setTimeout(() => setMensagemUndo(null), 6000);
    }
  };

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const mesAnoStr = `${year}-${String(month + 1).padStart(2, '0')}`;

  const daysInMonth = useMemo(() => {
    return new Date(year, month + 1, 0).getDate();
  }, [year, month]);

  const daysArray = useMemo(() => {
    return Array.from({ length: daysInMonth }, (_, i) => i + 1);
  }, [daysInMonth]);

  const monthName = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
  }).format(currentDate);

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  const formatDayDate = (day: number) => {
    const m = String(month + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    return `${year}-${m}-${d}`;
  };

  const getWeekDayLabel = (day: number) => {
    const d = new Date(year, month, day);
    return new Intl.DateTimeFormat('pt-BR', { weekday: 'narrow' }).format(d);
  };

  const isSunday = (day: number) => {
    return new Date(year, month, day).getDay() === 0;
  };

  const obterSiglaTurno = (turno?: string, horarioInicio?: string) => {
    const t = (turno || '').toLowerCase();
    const h = (horarioInicio || '').trim();
    if (t.includes('folga') || t === 'fol' || t === 's' || t === 'dsr') return 'FOL';
    if (t.includes('férias') || t.includes('ferias') || t === 'fer' || t === 'fe') return 'FER';
    if (t.includes('adm') || t.includes('admin') || t === 'adm' || (h.startsWith('08:') && (t.includes('17h') || t.includes('18h')))) return 'ADM';
    if (t.includes('horista') || t === 'hor' || t === 'h') return 'HOR';
    if (t.includes('plantão') || t.includes('plantao') || t.includes('12x36') || t === 'plt') return 'PLT';
    if (t.includes('noite') || t.includes('turno 3') || t === 't3' || t.startsWith('3t') || h.startsWith('22:') || h.startsWith('23:')) {
      return 'T3';
    }
    // Prioriza Turno 1 Manhã (06h - 14h / 1T / T1) para não colidir com '14h' do final de turno
    if (
      t.includes('turno 1') ||
      t.includes('manhã') ||
      t.includes('manha') ||
      t.includes('matutino') ||
      t === 't1' ||
      t === '1t' ||
      t.startsWith('1t') ||
      t.includes('06-14') ||
      t.includes('06h') ||
      h.startsWith('05:') ||
      h.startsWith('06:') ||
      h.startsWith('07:')
    ) {
      return 'T1';
    }
    // Turno 2 Tarde (14h - 22h / 2T / T2)
    if (
      t.includes('turno 2') ||
      t.includes('tarde') ||
      t.includes('vespertino') ||
      t === 't2' ||
      t === '2t' ||
      t.startsWith('2t') ||
      t.includes('14-22') ||
      (t.includes('14h') && !t.includes('06h')) ||
      h.startsWith('12:') ||
      h.startsWith('13:') ||
      h.startsWith('14:') ||
      h.startsWith('15:')
    ) {
      return 'T2';
    }
    return 'T1';
  };

  const obterHorarioPorTurno = (turno: string) => {
    const of = TURNOS_OFICIAIS.find((t) => t.id === turno || t.sigla === turno);
    if (of) return { inicio: of.inicio, fim: of.fim };
    if (turno.includes('ADM') || turno.includes('Administrativo')) return { inicio: '08:00', fim: '17:00' };
    if (turno.includes('Folga') || turno.includes('Férias')) return { inicio: '00:00', fim: '00:00' };
    if (turno.includes('Plantão') || turno.includes('12x36')) return { inicio: '06:00', fim: '18:00' };
    if (turno.includes('Horista')) return { inicio: '08:00', fim: '14:00' };
    if (turno.includes('Noite') || turno.includes('Turno 3')) return { inicio: '22:00', fim: '06:00' };
    if (turno.includes('Turno 2') || turno.includes('Tarde')) return { inicio: '14:00', fim: '22:00' };
    return { inicio: '06:00', fim: '14:00' };
  };

  // Mapa de escalas do mês indexado tanto por ID quanto por nome normalizado (garante que nenhum turno anexado fique invisível)
  const escalaMap = useMemo(() => {
    const map: Record<string, Escala> = {};
    escalas.forEach((e) => {
      if (e.funcionarioId) {
        map[`${e.funcionarioId}_${e.data}`] = e;
      }
      if (e.funcionarioNome) {
        const nomeKey = normalizarTextoComparacao(e.funcionarioNome);
        if (nomeKey) {
          map[`nome:${nomeKey}_${e.data}`] = e;
        }
      }
    });
    return map;
  }, [escalas]);

  // Combina os funcionários cadastrados com eventuais colaboradores que já possuem escala anexada neste mês
  const listaFuncionariosConsolidada = useMemo(() => {
    const base = [...funcionarios];
    const idsVistos = new Set(base.map((f) => f.id));
    const nomesVistos = new Set(base.map((f) => normalizarTextoComparacao(f.nome)));

    escalas
      .filter((e) => e.data && e.data.startsWith(mesAnoStr))
      .forEach((e) => {
        const nomeNorm = normalizarTextoComparacao(e.funcionarioNome);
        if (!nomeNorm) return;
        if ((e.funcionarioId && idsVistos.has(e.funcionarioId)) || nomesVistos.has(nomeNorm)) {
          return;
        }
        const fId = e.funcionarioId || `func-escala-${nomeNorm.replace(/\s+/g, '-')}`;
        idsVistos.add(fId);
        nomesVistos.add(nomeNorm);
        base.push({
          id: fId,
          postoId,
          nome: e.funcionarioNome,
          cpf: '000.000.000-00',
          matricula: 'ESC-AUTO',
          telefone: '',
          cargo: e.funcao || 'Frentista',
          funcao: e.funcao || 'Frentista',
          setor: e.setor || 'Pista',
          turnoPreferencial: normalizarTurnoPreferencialCadastro(e.turno, e.horarioInicio),
          dataAdmissao: e.data,
          status: 'ATIVO',
          criadoEm: e.criadoEm || new Date().toISOString(),
          atualizadoEm: e.atualizadoEm || new Date().toISOString(),
        });
      });

    return base;
  }, [funcionarios, escalas, mesAnoStr, postoId]);

  // Auditoria Automática de Conflitos na Escala (Executada em tempo real sobre a grade)
  const resultadoAuditoria = useMemo(() => {
    return analisarConflitosEscala({
      funcionarios: listaFuncionariosConsolidada,
      escalas,
      anoMes: mesAnoStr,
      config: configRegras,
    });
  }, [listaFuncionariosConsolidada, escalas, mesAnoStr, configRegras]);

  const funcionariosAtivos = useMemo(() => {
    const idsComConflito = new Set<string>();
    const nomesComConflito = new Set<string>();

    if (filtrarApenasComConflito) {
      resultadoAuditoria.conflitos.forEach((c) => {
        if (c.funcionarioId) idsComConflito.add(c.funcionarioId);
        if (c.funcionarioNome) nomesComConflito.add(normalizarTextoComparacao(c.funcionarioNome));
      });
    }

    return listaFuncionariosConsolidada.filter((f) => {
      if (f.status === 'INATIVO') return false;

      // Filtro para focar exclusivamente em colaboradores com inconsistências detectadas
      if (filtrarApenasComConflito) {
        const nomeNorm = normalizarTextoComparacao(f.nome);
        const temConflito = idsComConflito.has(f.id) || nomesComConflito.has(nomeNorm);
        if (!temConflito) return false;
      }

      if (selectedTurnoFiltro !== 'TODOS') {
        const siglaFunc = obterSiglaTurno(f.turnoPreferencial);
        const siglaFiltro = obterSiglaTurno(selectedTurnoFiltro);
        if (f.turnoPreferencial !== selectedTurnoFiltro && siglaFunc !== siglaFiltro) {
          return false;
        }
      }
      if (filtroSetor !== 'TODOS' && (f.setor || 'Pista') !== filtroSetor) {
        return false;
      }
      if (buscaTexto.trim()) {
        const q = buscaTexto.toLowerCase().trim();
        if (
          !f.nome.toLowerCase().includes(q) &&
          !(f.cargo || '').toLowerCase().includes(q) &&
          !(f.setor || '').toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [
    listaFuncionariosConsolidada,
    selectedTurnoFiltro,
    filtroSetor,
    buscaTexto,
    filtrarApenasComConflito,
    resultadoAuditoria,
  ]);

  const handleChangeConfigRegras = (novaConfig: ConfiguracaoRegrasEscala) => {
    setConfigRegras(novaConfig);
    try {
      localStorage.setItem('planner_regras_escala', JSON.stringify(novaConfig));
    } catch {}
  };

  const handleAplicarFolgaRapida = async (funcionarioId: string, dataIso: string) => {
    try {
      const func = listaFuncionariosConsolidada.find((f) => f.id === funcionarioId);
      const id = `escala-${funcionarioId}-${dataIso}`;
      const agoraIso = new Date().toISOString();

      const escalaFolga: Escala = {
        id,
        postoId,
        funcionarioId,
        funcionarioNome: func?.nome || 'Colaborador',
        data: dataIso,
        turno: 'Folga',
        horarioInicio: '00:00',
        horarioFim: '00:00',
        intervalo: '—',
        setor: func?.setor || 'Pista',
        funcao: func?.funcao || func?.cargo || 'Frentista',
        status: 'FOLGA',
        codigoOriginal: 'S',
        statusConferencia: 'CONFIRMADO',
        observacao: 'Folga (S) concedida para adequação de descanso regulamentar',
        criadoEm: agoraIso,
        atualizadoEm: agoraIso,
      };

      await repoEscala.save(postoId, escalaFolga);
      onReload();
    } catch (err: any) {
      console.error('Erro ao conceder folga rápida:', err);
    }
  };

  const handleNavegarParaCelula = (funcionarioId: string, day: number, _dataIso: string) => {
    const func = listaFuncionariosConsolidada.find((f) => f.id === funcionarioId);
    if (func) {
      handleCellClick(func, day);
    }
  };

  const escalasMesFiltradas = useMemo(() => {
    return escalas.filter((e) => {
      if (!e.data.startsWith(mesAnoStr)) return false;
      if (filtroSetor !== 'TODOS' && (e.setor || 'Pista') !== filtroSetor) return false;
      if (buscaTexto.trim()) {
        const q = buscaTexto.toLowerCase().trim();
        if (
          !e.funcionarioNome.toLowerCase().includes(q) &&
          !(e.setor || '').toLowerCase().includes(q) &&
          !e.turno.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [escalas, mesAnoStr, filtroSetor, buscaTexto]);

  // Clique em uma célula do Planner
  const handleCellClick = async (func: Funcionario, day: number) => {
    const dateStr = formatDayDate(day);
    const current =
      escalaMap[`${func.id}_${dateStr}`] ||
      escalaMap[`nome:${normalizarTextoComparacao(func.nome)}_${dateStr}`];

    if (!modoRapido) {
      setCelulaEditando({
        func,
        day,
        dateStr,
        escalaExistente: current,
      });
      if (current) {
        setModalStatus(current.status);
        setModalTurno(
          current.turno && current.turno !== 'Folga'
            ? current.turno
            : func.turnoPreferencial || 'Turno 1 - Manhã (06h - 14h)'
        );
        setModalInicio(current.horarioInicio || '06:00');
        setModalFim(current.horarioFim || '14:00');
        setModalIntervalo(current.intervalo || '1h (Intrajornada)');
        setModalSetor(current.setor || func.setor || 'Pista');
        setModalFuncao(current.funcao || func.funcao || func.cargo || 'Frentista');
        setModalObs(current.observacao || '');
      } else {
        const turnoPadrao = func.turnoPreferencial || 'Turno 1 - Manhã (06h - 14h)';
        const h = obterHorarioPorTurno(turnoPadrao);
        setModalStatus('TRABALHO');
        setModalTurno(turnoPadrao);
        setModalInicio(h.inicio);
        setModalFim(h.fim);
        setModalIntervalo('1h (Intrajornada)');
        setModalSetor(func.setor || 'Pista');
        setModalFuncao(func.funcao || func.cargo || 'Frentista');
        setModalObs('');
      }
      return;
    }

    // Modo Pincel Rápido
    let nextStatus: EscalaStatus = 'TRABALHO';
    let nextTurno = func.turnoPreferencial || 'Turno 1 - Manhã (06h - 14h)';

    if (pincelStatus === 'T1_MANHA') {
      nextStatus = 'TRABALHO';
      nextTurno = 'Turno 1 - Manhã (06h - 14h)';
    } else if (pincelStatus === 'T2_TARDE') {
      nextStatus = 'TRABALHO';
      nextTurno = 'Turno 2 - Tarde (14h - 22h)';
    } else if (pincelStatus === 'HORISTA') {
      nextStatus = 'TRABALHO';
      nextTurno = 'Turno Horista';
    } else if (pincelStatus === 'ADM') {
      nextStatus = 'TRABALHO';
      nextTurno = 'Turno ADM (08h - 17h)';
    } else if (pincelStatus === 'FOLGA') {
      nextStatus = 'FOLGA';
      nextTurno = 'Folga';
    } else if (pincelStatus === 'FERIAS') {
      nextStatus = 'FERIAS';
      nextTurno = 'Férias';
    } else if (pincelStatus === 'T3_NOITE') {
      nextStatus = 'TRABALHO';
      nextTurno = 'Turno 3 - Noite (22h - 06h)';
    } else {
      nextStatus = pincelStatus;
      nextTurno = func.turnoPreferencial || 'Turno 1 - Manhã (06h - 14h)';
    }

    const horarios = nextStatus === 'FOLGA' ? { inicio: '00:00', fim: '00:00' } : obterHorarioPorTurno(nextTurno);
    const id = current?.id || `escala-${func.id}-${dateStr}`;

    const novaEscala: Escala = {
      id,
      postoId,
      funcionarioId: func.id,
      funcionarioNome: func.nome,
      data: dateStr,
      turno: nextTurno,
      horarioInicio: horarios.inicio,
      horarioFim: horarios.fim,
      status: nextStatus,
      observacao: current?.observacao || '',
      criadoEm: current?.criadoEm || new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
    };

    await repoEscala.save(postoId, novaEscala);
    onReload();
  };

  // Salvar alteração da célula no modal
  const handleSalvarCelulaModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!celulaEditando) return;
    const { func, dateStr, escalaExistente } = celulaEditando;
    const id = escalaExistente?.id || `escala-${func.id}-${dateStr}`;
    const ehFolga = modalStatus === 'FOLGA';

    const agoraIso = new Date().toISOString();
    const historicoAnterior = escalaExistente?.historicoAlteracoes || [];
    const novoHistorico = escalaExistente
      ? [
          ...historicoAnterior,
          {
            dataHora: agoraIso,
            usuario: userProfile?.nome || 'Operador',
            acao: 'Edição manual no Planner',
            valorAnterior: `${escalaExistente.turno} (${escalaExistente.horarioInicio}-${escalaExistente.horarioFim})`,
            valorNovo: `${ehFolga ? 'Folga' : modalTurno} (${ehFolga ? '00:00' : modalInicio}-${
              ehFolga ? '00:00' : modalFim
            })`,
          },
        ]
      : historicoAnterior;

    const novaEscala: Escala = {
      id,
      postoId,
      funcionarioId: func.id,
      funcionarioNome: func.nome,
      data: dateStr,
      turno: ehFolga ? 'Folga' : modalTurno,
      horarioInicio: ehFolga ? '00:00' : modalInicio,
      horarioFim: ehFolga ? '00:00' : modalFim,
      intervalo: ehFolga ? '—' : modalIntervalo,
      setor: modalSetor || 'Pista',
      funcao: modalFuncao || func.cargo || 'Frentista',
      status: modalStatus,
      observacao: modalObs.trim(),
      historicoAlteracoes: novoHistorico,
      criadoEm: escalaExistente?.criadoEm || agoraIso,
      atualizadoEm: agoraIso,
    };

    await repoEscala.save(postoId, novaEscala);
    await registrarAuditoria(
      postoId,
      userProfile?.uid || 'anon',
      userProfile?.nome || 'Operador',
      'ESCALAS',
      'Escala',
      id,
      escalaExistente ? 'UPDATE' : 'CREATE',
      escalaExistente as unknown as Record<string, unknown>,
      novaEscala as unknown as Record<string, unknown>
    );
    setCelulaEditando(null);
    onReload();
  };

  const handleExcluirCelulaModal = async () => {
    if (!celulaEditando?.escalaExistente) return;
    const esc = celulaEditando.escalaExistente;
    await repoEscala.delete(postoId, esc.id);
    await repoEscala.delete(postoId, `escala-${esc.funcionarioId}-${esc.data}`).catch(() => {});
    await repoEscala.delete(postoId, `escala-ia-${esc.funcionarioId}-${esc.data}`).catch(() => {});
    setCelulaEditando(null);
    onReload();
  };

  const handleLimparEscalaFuncionarioMes = async (func: Funcionario) => {
    if (!window.confirm(`Deseja excluir todos os lançamentos de escala de ${func.nome} neste mês?`)) return;
    setSalvandoAuto(true);
    try {
      const nomeNorm = normalizarTextoComparacao(func.nome);
      const doMes = escalas.filter(
        (e) =>
          (e.funcionarioId === func.id || normalizarTextoComparacao(e.funcionarioNome) === nomeNorm) &&
          e.data.startsWith(mesAnoStr)
      );
      await repoEscala.deleteBatch(
        postoId,
        doMes.map((item) => item.id)
      );
      onReload();
    } finally {
      setSalvandoAuto(false);
    }
  };

  const abrirEdicaoFuncionario = (func: Funcionario) => {
    setFuncEditando(func);
    setEditNome(func.nome);
    setEditCargo(func.cargo || 'Frentista');
    setEditTurnoPref(func.turnoPreferencial || 'Turno 1 - Manhã (06h - 14h)');
    setEditStatusFunc(func.status || 'ATIVO');
  };

  const handleSalvarEdicaoFuncionario = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!funcEditando) return;
    const atualizado: Funcionario = {
      ...funcEditando,
      nome: editNome.trim(),
      cargo: editCargo,
      turnoPreferencial: editTurnoPref,
      status: editStatusFunc,
      atualizadoEm: new Date().toISOString(),
    };
    await repoFunc.save(postoId, atualizado);
    setFuncEditando(null);
    onReload();
  };

  const handleExcluirFuncionario = async (func: Funcionario) => {
    if (!window.confirm(`Tem certeza que deseja excluir o cadastro do funcionário "${func.nome}"?`)) return;
    await repoFunc.delete(postoId, func.id);
    setFuncEditando(null);
    onReload();
  };

  const handlePreencherRevezamento6x1 = async (func: Funcionario, folgaInicialDia: number = 7) => {
    setSalvandoAuto(true);
    try {
      const turnoBase = func.turnoPreferencial || 'Turno 1 - Manhã (06h - 14h)';
      const horarios = obterHorarioPorTurno(turnoBase);
      const lote: Escala[] = [];
      const agora = new Date().toISOString();

      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = formatDayDate(day);
        const isFolga = (day - folgaInicialDia) % 7 === 0;
        const status: EscalaStatus = isFolga ? 'FOLGA' : 'TRABALHO';
        const id = `escala-${func.id}-${dateStr}`;

        lote.push({
          id,
          postoId,
          funcionarioId: func.id,
          funcionarioNome: func.nome,
          data: dateStr,
          turno: isFolga ? 'Folga' : turnoBase,
          horarioInicio: isFolga ? '00:00' : horarios.inicio,
          horarioFim: isFolga ? '00:00' : horarios.fim,
          status,
          observacao: isFolga ? 'S (Folga 6x1)' : '',
          criadoEm: agora,
          atualizadoEm: agora,
        });
      }
      await repoEscala.saveBatch(postoId, lote);
      onReload();
    } finally {
      setSalvandoAuto(false);
    }
  };

  const handleGerarEscalaMesInteiro = async () => {
    if (funcionariosAtivos.length === 0) return;
    setSalvandoAuto(true);
    try {
      const loteTotal: Escala[] = [];
      const agora = new Date().toISOString();

      for (let i = 0; i < funcionariosAtivos.length; i++) {
        const func = funcionariosAtivos[i];
        const diaFolgaBase = (i % 7) + 1;
        const turnoBase = func.turnoPreferencial || 'Turno 1 - Manhã (06h - 14h)';
        const horarios = obterHorarioPorTurno(turnoBase);

        for (let day = 1; day <= daysInMonth; day++) {
          const dateStr = formatDayDate(day);
          const isFolga = (day - diaFolgaBase) % 7 === 0;
          loteTotal.push({
            id: `escala-${func.id}-${dateStr}`,
            postoId,
            funcionarioId: func.id,
            funcionarioNome: func.nome,
            data: dateStr,
            turno: isFolga ? 'Folga' : turnoBase,
            horarioInicio: isFolga ? '00:00' : horarios.inicio,
            horarioFim: isFolga ? '00:00' : horarios.fim,
            status: isFolga ? 'FOLGA' : 'TRABALHO',
            observacao: isFolga ? 'S (Folga 6x1)' : '',
            criadoEm: agora,
            atualizadoEm: agora,
          });
        }
      }

      await repoEscala.saveBatch(postoId, loteTotal);
      onReload();
    } finally {
      setSalvandoAuto(false);
    }
  };


  return (
    <div className="space-y-5">
      {/* Cabeçalho e Ações Principais */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <CalendarIcon className="w-5 h-5 text-blue-600" />
            Planner de escalas
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Organize os turnos na grade ou importe uma foto com conferência antes de salvar.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Seletor de Mês */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={prevMonth}
              className="p-1.5 hover:bg-white rounded-md transition text-slate-700 cursor-pointer"
              title="Mês anterior"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-bold text-slate-800 capitalize min-w-[120px] text-center">
              {monthName}
            </span>
            <button
              type="button"
              onClick={nextMonth}
              className="p-1.5 hover:bg-white rounded-md transition text-slate-700 cursor-pointer"
              title="Próximo mês"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setModalImportarImagemAberto(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition shadow-xs cursor-pointer active:scale-98"
          >
            <Sparkles className="w-4 h-4" />
            <span>Importar por Imagem</span>
          </button>

          <button
            type="button"
            disabled={salvandoAuto || funcionariosAtivos.length === 0}
            onClick={handleGerarEscalaMesInteiro}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-xs font-semibold rounded-lg transition disabled:opacity-50 cursor-pointer"
          >
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            <span>{salvandoAuto ? 'Processando...' : 'Gerar Escala 6x1'}</span>
          </button>

          <button
            type="button"
            disabled={desfazendoImportacao}
            onClick={handleDesfazerUltimaImportacao}
            title="Desfazer a última importação de escala e restaurar o estado anterior"
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-xs font-semibold rounded-lg transition disabled:opacity-50 cursor-pointer"
          >
            <Undo2 className="w-3.5 h-3.5 text-slate-500" />
            <span>{desfazendoImportacao ? 'Restaurando...' : 'Desfazer'}</span>
          </button>

          <button
            type="button"
            disabled={limpandoPlanner || escalas.filter((e) => e.data && e.data.startsWith(mesAnoStr)).length === 0}
            onClick={handleLimparPlannerMes}
            title="Limpar todos os registros de escala do mês atual"
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-700 border border-slate-200 text-xs font-semibold rounded-lg transition disabled:opacity-50 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{limpandoPlanner ? 'Limpando...' : 'Limpar Mês'}</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-xs font-semibold rounded-lg transition cursor-pointer print:hidden"
          >
            <Printer className="w-3.5 h-3.5 text-slate-500" />
            <span>Imprimir</span>
          </button>
        </div>
      </div>

      {/* Banner de Notificação de Desfazer Importação */}
      {mensagemUndo && (
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 text-xs font-semibold ${
            mensagemUndo.tipo === 'sucesso'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {mensagemUndo.tipo === 'sucesso' ? (
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{mensagemUndo.texto}</span>
          </div>
          <button
            type="button"
            onClick={() => setMensagemUndo(null)}
            className="text-slate-400 hover:text-slate-700 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Painel Inteligente de Auditoria de Conflitos da Escala (CLT, Interjornadas e Cobertura Mínima) */}
      <PainelConflitosEscala
        resultadoAuditoria={resultadoAuditoria}
        configRegras={configRegras}
        onChangeConfigRegras={handleChangeConfigRegras}
        destacarNaGrade={destacarConflitosNaGrade}
        onToggleDestacarNaGrade={setDestacarConflitosNaGrade}
        filtrarApenasComConflito={filtrarApenasComConflito}
        onToggleFiltrarApenasComConflito={setFiltrarApenasComConflito}
        onNavegarParaCelula={handleNavegarParaCelula}
        onAplicarFolgaRapida={handleAplicarFolgaRapida}
      />

      {/* Painel de 7 Visualizações do Planner */}
      <PainelVisualizacoesPlanner
        modoVisao={modoVisao}
        onChangeModoVisao={setModoVisao}
        escalasMes={escalasMesFiltradas}
        todasEscalas={escalas}
        funcionarios={funcionariosAtivos}
        escalasImportadas={escalasImportadas}
        anoMesAtual={mesAnoStr}
        buscaTexto={buscaTexto}
        onChangeBuscaTexto={setBuscaTexto}
        filtroSetor={filtroSetor}
        onChangeFiltroSetor={setFiltroSetor}
        resultadoAuditoria={resultadoAuditoria}
        onNovoRegistroManual={() => {
          const funcPadrao = funcionariosAtivos[0] || funcionarios[0];
          if (funcPadrao) {
            handleCellClick(funcPadrao, new Date().getDate());
          }
        }}
        onEditarRegistroEscala={(esc) => {
          const func =
            listaFuncionariosConsolidada.find((f) => f.id === esc.funcionarioId) || {
              id: esc.funcionarioId,
              postoId,
              nome: esc.funcionarioNome,
              cpf: '',
              matricula: '',
              telefone: '',
              cargo: esc.funcao || 'Frentista',
              funcao: esc.funcao || 'Frentista',
              setor: esc.setor || 'Pista',
              turnoPreferencial: esc.turno,
              dataAdmissao: '',
              status: 'ATIVO',
              criadoEm: '',
              atualizadoEm: '',
            };
          const diaNum = parseInt(esc.data.split('-')[2] || '1', 10);
          setCelulaEditando({
            func,
            day: diaNum,
            dateStr: esc.data,
            escalaExistente: esc,
          });
          setModalStatus(esc.status);
          setModalTurno(esc.turno);
          setModalInicio(esc.horarioInicio);
          setModalFim(esc.horarioFim);
          setModalIntervalo(esc.intervalo || '1h');
          setModalSetor(esc.setor || 'Pista');
          setModalFuncao(esc.funcao || 'Frentista');
          setModalObs(esc.observacao || '');
        }}
        onExcluirRegistroEscala={async (esc) => {
          await repoEscala.delete(postoId, esc.id);
          onReload();
        }}
      />

      {/* Barra de Filtro e Modo de Clique */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setModoRapido(!modoRapido)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
              modoRapido
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
            }`}
          >
            {modoRapido ? 'Pincel Rápido: ATIVO (1 clique aplica)' : 'Modo Normal: Clique na célula para Alterar / Excluir'}
          </button>

          {modoRapido && (
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'T1_MANHA', label: 'T1 — Manhã (06h-14h)', color: 'bg-amber-500 text-white' },
                  { id: 'T2_TARDE', label: 'T2 — Tarde (14h-22h)', color: 'bg-blue-600 text-white' },
                  { id: 'HORISTA', label: 'HOR — Horista', color: 'bg-teal-600 text-white' },
                  { id: 'ADM', label: 'ADM — Administrativo', color: 'bg-indigo-600 text-white' },
                  { id: 'FOLGA', label: 'FOL — Folga (DSR)', color: 'bg-emerald-600 text-white' },
                  { id: 'FERIAS', label: 'FER — Férias', color: 'bg-orange-600 text-white' },
                  { id: 'ATESTADO', label: 'AT — Atestado', color: 'bg-slate-600 text-white' },
                  { id: 'AUSENTE', label: 'FA — Falta', color: 'bg-red-600 text-white' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPincelStatus(item.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                    pincelStatus === item.id
                      ? `${item.color} ring-2 ring-offset-1 ring-slate-400`
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">Filtrar Turno:</span>
          <select
            value={selectedTurnoFiltro}
            onChange={(e) => setSelectedTurnoFiltro(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-semibold text-slate-700"
          >
            <option value="TODOS">Todos os Turnos</option>
            {TURNOS_OFICIAIS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Grade Mensal do Planner */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        {/* Dica para dispositivos móveis */}
        <div className="md:hidden bg-blue-50 border-b border-blue-200 px-3.5 py-2 text-[11px] text-blue-800 flex items-center justify-between">
          <span>💡 No celular, deslize horizontalmente ou use as visualizações <strong>Semanal</strong> ou <strong>Diária</strong> acima.</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-900 text-white border-b border-slate-700 text-[11px] font-semibold uppercase">
                <th className="py-3 px-2 sm:px-4 sticky left-0 bg-slate-900 z-20 min-w-[130px] sm:min-w-[190px] md:min-w-[240px] border-r border-slate-700">
                  Funcionário / Turno / Ações
                </th>
                {daysArray.map((day) => {
                  const dom = isSunday(day);
                  return (
                    <th
                      key={day}
                      className={`py-2 px-1 text-center min-w-[38px] border-r border-slate-800 ${
                        dom ? 'bg-red-950/60 text-red-300' : ''
                      }`}
                    >
                      <div className="text-[9px] opacity-75">{getWeekDayLabel(day)}</div>
                      <div className="font-mono text-xs font-bold">{String(day).padStart(2, '0')}</div>
                    </th>
                  );
                })}
                <th className="py-2 px-3 text-center bg-slate-800 min-w-[95px]">Resumo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {funcionariosAtivos.length === 0 ? (
                <tr>
                  <td colSpan={daysInMonth + 2} className="py-12 text-center text-slate-400">
                    Nenhum funcionário encontrado para o filtro selecionado.
                  </td>
                </tr>
              ) : (
                funcionariosAtivos.map((func) => {
                  let countTrabalhados = 0;
                  let countFolgas = 0;
                  const nomeFuncNorm = normalizarTextoComparacao(func.nome);

                  return (
                    <tr key={func.id} className="hover:bg-slate-50/80 transition group">
                      <td className="py-2 px-2 sm:px-3 sticky left-0 bg-white group-hover:bg-slate-50 z-10 min-w-[130px] sm:min-w-[190px] md:min-w-[240px] border-r border-slate-200">
                        <div className="flex items-center justify-between gap-1 sm:gap-2">
                          <div className="truncate min-w-0">
                            <div className="font-bold text-slate-900 truncate max-w-[85px] sm:max-w-[130px] md:max-w-none">{func.nome}</div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[10px] text-slate-500">{func.cargo}</span>
                              <span
                                className={`text-[9px] px-1.5 py-0.2 rounded font-bold border ${
                                  obterSiglaTurno(func.turnoPreferencial) === 'ADM'
                                    ? 'bg-indigo-50 text-indigo-800 border-indigo-200'
                                    : obterSiglaTurno(func.turnoPreferencial) === 'HOR'
                                    ? 'bg-teal-50 text-teal-800 border-teal-200'
                                    : obterSiglaTurno(func.turnoPreferencial) === 'T2'
                                    ? 'bg-blue-50 text-blue-800 border-blue-200'
                                    : obterSiglaTurno(func.turnoPreferencial) === 'T3'
                                    ? 'bg-purple-50 text-purple-800 border-purple-200'
                                    : 'bg-amber-50 text-amber-800 border-amber-200'
                                }`}
                              >
                                {obterSiglaTurno(func.turnoPreferencial)}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handlePreencherRevezamento6x1(func)}
                              title="Preencher escala 6x1 para este funcionário"
                              className="p-1 text-blue-600 hover:bg-blue-50 rounded transition"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => abrirEdicaoFuncionario(func)}
                              title="Alterar cadastro deste funcionário"
                              className="p-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded transition"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleLimparEscalaFuncionarioMes(func)}
                              title="Excluir/Limpar escala do mês deste funcionário"
                              className="p-1 text-red-500 hover:bg-red-50 rounded transition"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </td>

                      {daysArray.map((day) => {
                        const dateStr = formatDayDate(day);
                        const esc =
                          escalaMap[`${func.id}_${dateStr}`] ||
                          escalaMap[`nome:${nomeFuncNorm}_${dateStr}`];
                        const status = esc?.status;

                        if (status === 'TRABALHO' || status === 'PLANTAO') countTrabalhados++;
                        if (status === 'FOLGA') countFolgas++;

                        let cellStyle = 'bg-white text-slate-300 hover:bg-slate-100';
                        let label = '·';

                        if (status === 'TRABALHO' || status === 'PLANTAO') {
                          const sig =
                            status === 'PLANTAO'
                              ? 'PLT'
                              : obterSiglaTurno(esc?.turno || func.turnoPreferencial, esc?.horarioInicio);
                          label = sig;
                          if (sig === 'T1') {
                            cellStyle = 'bg-amber-100 text-amber-900 font-bold hover:bg-amber-200';
                          } else if (sig === 'T2') {
                            cellStyle = 'bg-blue-100 text-blue-900 font-bold hover:bg-blue-200';
                          } else if (sig === 'HOR') {
                            cellStyle = 'bg-teal-100 text-teal-900 font-bold hover:bg-teal-200';
                          } else if (sig === 'ADM') {
                            cellStyle = 'bg-indigo-100 text-indigo-900 font-bold hover:bg-indigo-200';
                          } else if (sig === 'T3') {
                            cellStyle = 'bg-purple-100 text-purple-900 font-bold hover:bg-purple-200';
                          } else if (sig === 'PLT') {
                            cellStyle = 'bg-sky-100 text-sky-900 font-bold hover:bg-sky-200';
                          } else {
                            cellStyle = 'bg-teal-100 text-teal-900 font-bold hover:bg-teal-200';
                          }
                        } else if (status === 'FOLGA') {
                          cellStyle = 'bg-emerald-100 text-emerald-900 font-black hover:bg-emerald-200';
                          label = 'FOL';
                        } else if (status === 'FERIAS') {
                          cellStyle = 'bg-orange-100 text-orange-900 font-bold hover:bg-orange-200';
                          label = 'FER';
                        } else if (status === 'ATESTADO' || status === 'AFASTADO') {
                          cellStyle = 'bg-slate-200 text-slate-800 font-bold';
                          label = 'AT';
                        } else if (status === 'AUSENTE') {
                          cellStyle = 'bg-red-100 text-red-800 font-bold';
                          label = 'FA';
                        }

                        // Verificação de Conflitos Detectados nesta Célula
                        const conflitosCelula: ConflitoEscala[] =
                          resultadoAuditoria.mapaConflitosPorCelula[`${func.id}_${dateStr}`] ||
                          resultadoAuditoria.mapaConflitosPorCelula[`nome:${nomeFuncNorm}_${dateStr}`] ||
                          [];
                        const temConflito = conflitosCelula.length > 0;
                        const temConflitoCritico = conflitosCelula.some((c) => c.severidade === 'CRITICO');

                        if (temConflito && destacarConflitosNaGrade) {
                          if (temConflitoCritico) {
                            cellStyle += ' ring-2 ring-red-500 ring-inset bg-red-50/80';
                          } else {
                            cellStyle += ' ring-2 ring-amber-500 ring-inset bg-amber-50/80';
                          }
                        }

                        const tooltipBase = esc
                          ? `${func.nome} — Dia ${day}: ${
                              esc.status === 'FOLGA'
                                ? 'Folga (S)'
                                : `${esc.turno} (${esc.horarioInicio}-${esc.horarioFim})`
                            } (Clique para alterar ou excluir)`
                          : `Dia ${day}: Sem lançamento (Clique para lançar)`;

                        const tooltipConflito =
                          temConflito && destacarConflitosNaGrade
                            ? `\n\n🚨 ALERTA DE CONFLITO NA ESCALA:\n${conflitosCelula
                                .map(
                                  (c) =>
                                    `• [${c.severidade}] ${c.titulo}:\n  ${c.descricao}\n  Sugestão: ${c.sugestaoCorrecao}`
                                )
                                .join('\n\n')}`
                            : '';

                        return (
                          <td
                            key={day}
                            onClick={() => handleCellClick(func, day)}
                            title={`${tooltipBase}${tooltipConflito}`}
                            className={`p-1 text-center border-r border-slate-100 cursor-pointer select-none transition ${cellStyle}`}
                          >
                            <div className="w-full h-7 flex items-center justify-center rounded text-[11px] font-mono relative">
                              {label}
                              {temConflito && destacarConflitosNaGrade && (
                                <span
                                  className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full ring-2 ring-white ${
                                    temConflitoCritico ? 'bg-red-600' : 'bg-amber-500'
                                  }`}
                                  title={conflitosCelula.map((c) => `${c.titulo}: ${c.descricao}`).join(' | ')}
                                />
                              )}
                            </div>
                          </td>
                        );
                      })}

                      <td className="py-2 px-3 text-center bg-slate-50 font-mono text-[11px]">
                        <span className="text-blue-700 font-bold">{countTrabalhados}T</span>
                        <span className="mx-1 text-slate-300">/</span>
                        <span className="text-emerald-700 font-bold">{countFolgas}S</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            <tfoot>
              {/* Linha de Auditoria de Cobertura Diária por Turno (T1 / T2 / T3) */}
              <tr className="bg-slate-900 text-white font-mono text-[10px] border-t-2 border-slate-700">
                <td className="py-2.5 px-3 sticky left-0 bg-slate-900 z-10 border-r border-slate-700">
                  <div className="flex items-center justify-between">
                    <div className="font-bold flex items-center gap-1.5 text-xs text-slate-100">
                      <Users className="w-3.5 h-3.5 text-blue-400" />
                      Cobertura por Turno
                    </div>
                    <span className="text-[9px] text-slate-400">T1/T2/T3</span>
                  </div>
                </td>
                {daysArray.map((day) => {
                  const cob = resultadoAuditoria.coberturaPorDia[day] || { T1: 0, T2: 0, T3: 0 };
                  const descobertos = resultadoAuditoria.turnosDescobertosPorDia[day] || [];
                  const temDescoberto = descobertos.length > 0;
                  const dom = isSunday(day);

                  let bgClass = dom ? 'bg-slate-900/90' : 'bg-slate-900';
                  if (temDescoberto && destacarConflitosNaGrade) {
                    bgClass = 'bg-red-950 text-red-200 ring-1 ring-red-500 ring-inset font-bold';
                  }

                  const tooltipCob = `Dia ${String(day).padStart(2, '0')}:
• 1º Turno (Manhã T1): ${cob.T1} funcionário(s)
• 2º Turno (Tarde T2): ${cob.T2} funcionário(s)
• 3º Turno (Noite T3): ${cob.T3} funcionário(s)
${temDescoberto ? `\n🚨 CRÍTICO: Turno(s) ${descobertos.join(', ')} sem nenhuma cobertura no dia!` : ''}`;

                  return (
                    <td
                      key={`cob-${day}`}
                      title={tooltipCob}
                      className={`p-1 text-center border-r border-slate-800 ${bgClass}`}
                    >
                      <div className="text-[9px] leading-tight select-none">
                        <div className={cob.T1 === 0 ? 'text-red-400 font-bold' : 'text-amber-300'}>
                          {cob.T1}
                        </div>
                        <div className={cob.T2 === 0 ? 'text-red-400 font-bold' : 'text-blue-300'}>
                          {cob.T2}
                        </div>
                        <div className={cob.T3 === 0 ? 'text-red-400 font-bold' : 'text-purple-300'}>
                          {cob.T3}
                        </div>
                      </div>
                    </td>
                  );
                })}
                <td className="py-2 px-3 text-center bg-slate-950 text-slate-400 text-[10px]">
                  Total/dia
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Legenda Clara */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            <span className="flex items-center gap-1.5 font-semibold text-slate-700">
              <span className="w-5 h-5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-mono font-bold flex items-center justify-center text-[10px]">
                T1
              </span>
              T1 — Manhã (06h-14h)
            </span>
            <span className="flex items-center gap-1.5 font-semibold text-slate-700">
              <span className="w-5 h-5 rounded bg-blue-100 text-blue-900 border border-blue-300 font-mono font-bold flex items-center justify-center text-[10px]">
                T2
              </span>
              T2 — Tarde (14h-22h)
            </span>
            <span className="flex items-center gap-1.5 font-semibold text-slate-700">
              <span className="w-5 h-5 rounded bg-teal-100 text-teal-900 border border-teal-300 font-mono font-bold flex items-center justify-center text-[10px]">
                HOR
              </span>
              HOR — Horista
            </span>
            <span className="flex items-center gap-1.5 font-semibold text-slate-700">
              <span className="w-5 h-5 rounded bg-indigo-100 text-indigo-900 border border-indigo-300 font-mono font-bold flex items-center justify-center text-[10px]">
                ADM
              </span>
              ADM — Administrativo
            </span>
            <span className="flex items-center gap-1.5 font-semibold text-slate-700">
              <span className="w-5 h-5 rounded bg-emerald-100 text-emerald-900 border border-emerald-300 font-mono font-black flex items-center justify-center text-[10px]">
                FOL
              </span>
              FOL — Folga (DSR)
            </span>
            <span className="flex items-center gap-1.5 font-semibold text-slate-700">
              <span className="w-5 h-5 rounded bg-orange-100 text-orange-900 border border-orange-300 font-mono font-bold flex items-center justify-center text-[10px]">
                FER
              </span>
              FER — Férias
            </span>
          </div>
          <span className="text-[11px] text-slate-500">
            Turnos Oficiais: T1, T2, Horista, ADM, Folga e Férias. Clique em qualquer célula para alterar ou usar o Pincel Rápido.
          </span>
        </div>
      </div>

      {/* MODAL 1: ALTERAR OU EXCLUIR CÉLULA DA ESCALA */}
      {celulaEditando && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {celulaEditando.escalaExistente ? 'Alterar ou Excluir Escala do Dia' : 'Lançar Escala do Dia'}
                </h3>
                <p className="text-xs text-slate-500">
                  {celulaEditando.func.nome} • Dia {String(celulaEditando.day).padStart(2, '0')}/{String(month + 1).padStart(2, '0')}/{year}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCelulaEditando(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSalvarCelulaModal} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1.5">
                  Situação no Dia (Turno ou Folga &quot;S&quot;)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { id: 'TRABALHO', label: 'Dia de Trabalho (Turno)' },
                      { id: 'FOLGA', label: 'S — Folga / DSR' },
                      { id: 'FERIAS', label: 'FE — Férias' },
                      { id: 'ATESTADO', label: 'AT — Atestado' },
                      { id: 'AUSENTE', label: 'FA — Falta' },
                    ] as const
                  ).map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => setModalStatus(st.id)}
                      className={`py-2 px-3 rounded-lg text-xs font-bold border text-left transition ${
                        modalStatus === st.id
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>

              {modalStatus === 'TRABALHO' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Turno de Trabalho
                  </label>
                  <select
                    value={modalTurno}
                    onChange={(e) => {
                      const novoT = e.target.value;
                      setModalTurno(novoT);
                      const h = obterHorarioPorTurno(novoT);
                      setModalInicio(h.inicio);
                      setModalFim(h.fim);
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold bg-white"
                  >
                    {TURNOS_OFICIAIS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.id}
                      </option>
                    ))}
                  </select>

                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Entrada</label>
                      <input
                        type="time"
                        value={modalInicio}
                        onChange={(e) => setModalInicio(e.target.value)}
                        className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Saída</label>
                      <input
                        type="time"
                        value={modalFim}
                        onChange={(e) => setModalFim(e.target.value)}
                        className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">Setor</label>
                  <input
                    type="text"
                    value={modalSetor}
                    onChange={(e) => setModalSetor(e.target.value)}
                    placeholder="Pista, Caixa..."
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">Função</label>
                  <input
                    type="text"
                    value={modalFuncao}
                    onChange={(e) => setModalFuncao(e.target.value)}
                    placeholder="Frentista..."
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">Intervalo</label>
                  <input
                    type="text"
                    value={modalIntervalo}
                    onChange={(e) => setModalIntervalo(e.target.value)}
                    placeholder="12:00 - 13:00"
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Observação (Opcional)</label>
                <input
                  type="text"
                  value={modalObs}
                  onChange={(e) => setModalObs(e.target.value)}
                  placeholder="Ex: Troca de folga, cobertura de horário..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-100 gap-2">
                {celulaEditando.escalaExistente ? (
                  <button
                    type="button"
                    onClick={handleExcluirCelulaModal}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-xs font-bold transition"
                  >
                    <Trash2 className="w-4 h-4" />
                    Excluir Registro
                  </button>
                ) : (
                  <div />
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCelulaEditando(null)}
                    className="px-3.5 py-2 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition"
                  >
                    Salvar Alteração
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: ALTERAR OU EXCLUIR FUNCIONÁRIO DIRETO PELO PLANNER */}
      {funcEditando && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Alterar / Excluir Funcionário</h3>
              <button
                type="button"
                onClick={() => setFuncEditando(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSalvarEdicaoFuncionario} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Nome Completo</label>
                <input
                  type="text"
                  required
                  value={editNome}
                  onChange={(e) => setEditNome(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Cargo</label>
                  <select
                    value={editCargo}
                    onChange={(e) => setEditCargo(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                  >
                    <option value="Frentista">Frentista</option>
                    <option value="Operador de Caixa">Operador de Caixa</option>
                    <option value="Lubrificador">Lubrificador</option>
                    <option value="Supervisor de Pista">Supervisor de Pista</option>
                    <option value="Gerente">Gerente</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Status</label>
                  <select
                    value={editStatusFunc}
                    onChange={(e) => setEditStatusFunc(e.target.value as FuncionarioStatus)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                  >
                    <option value="ATIVO">Ativo</option>
                    <option value="FERIAS">Férias</option>
                    <option value="AFASTADO">Afastado</option>
                    <option value="INATIVO">Inativo</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Turno Preferencial</label>
                <select
                  value={editTurnoPref}
                  onChange={(e) => setEditTurnoPref(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  {TURNOS_OFICIAIS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.id}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => handleExcluirFuncionario(funcEditando)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-xs font-bold transition"
                >
                  <Trash2 className="w-4 h-4" />
                  Excluir Funcionário
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setFuncEditando(null)}
                    className="px-3.5 py-2 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold"
                  >
                    Salvar
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      <ModalImportarEscalaImagem
        isOpen={modalImportarImagemAberto}
        onClose={() => setModalImportarImagemAberto(false)}
        funcionarios={funcionarios}
        anoMesAtual={mesAnoStr}
        currentDate={currentDate}
        onSuccess={onReload}
      />
    </div>
  );
};
