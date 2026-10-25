import React, { useState, useEffect, lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SyncProvider, useSync } from './contexts/SyncContext';
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
  LMCRegistro,
  RateioTurno,
  UserRole,
  EscalaImportada,
} from './types';
import { PostoSubcollectionRepository, testConnection, registrarAuditoria } from './repositories/firestoreRepository';
const DashboardView = lazy(() => import('./features/dashboard/DashboardView').then(module => ({ default: module.DashboardView })));
const FuncionariosView = lazy(() => import('./features/funcionarios/FuncionariosView').then(module => ({ default: module.FuncionariosView })));
const PlannerView = lazy(() => import('./features/planner/PlannerView').then(module => ({ default: module.PlannerView })));
const FechamentoCaixaView = lazy(() => import('./features/fechamento/FechamentoCaixaView').then(module => ({ default: module.FechamentoCaixaView })));
const SobrasFaltasView = lazy(() => import('./features/sobras-faltas/SobrasFaltasView').then(module => ({ default: module.SobrasFaltasView })));
const LMCView = lazy(() => import('./features/lmc/LMCView').then(module => ({ default: module.LMCView })));
const TanquesView = lazy(() => import('./features/tanques/TanquesView').then(module => ({ default: module.TanquesView })));
const BicosAfericoesView = lazy(() => import('./features/afericoes/BicosAfericoesView').then(module => ({ default: module.BicosAfericoesView })));
const AnalisesConformidadeView = lazy(() => import('./features/analises/AnalisesConformidadeView').then(module => ({ default: module.AnalisesConformidadeView })));
const RelatoriosView = lazy(() => import('./features/relatorios/RelatoriosView').then(module => ({ default: module.RelatoriosView })));
const IAEscalaView = lazy(() => import('./features/ia-escala/IAEscalaView').then(module => ({ default: module.IAEscalaView })));
import {
  LayoutDashboard,
  Users,
  Calendar,
  DollarSign,
  Fuel,
  Gauge,
  TestTubes,
  FileText,
  Sparkles,
  ShieldCheck,
  Wifi,
  WifiOff,
  LogOut,
  User,
  RefreshCw,
  Menu,
  X,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  BookOpen,
  Scale,
  Plus,
  ArrowRight,
  Sun,
  Sunrise,
  Moon,
  Zap,
  Clock,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';

class ModuleErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  declare props: { children: React.ReactNode };
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <section role="alert" className="rounded-2xl border border-amber-500/30 bg-white p-6 text-slate-100">
          <h2 className="text-lg font-bold">Não foi possível abrir este módulo</h2>
          <p className="mt-2 text-sm text-slate-600">Verifique sua conexão. Você pode acessar outro módulo pelo menu ou recarregar o aplicativo. Alterações ainda não salvas podem ser perdidas ao recarregar.</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-4 min-h-11 rounded-xl bg-blue-600 px-4 font-semibold text-white">Recarregar aplicativo</button>
        </section>
      );
    }
    return this.props.children;
  }
}

const repoFunc = new PostoSubcollectionRepository<Funcionario>('funcionarios');
const repoEscalas = new PostoSubcollectionRepository<Escala>('escalas');
const repoFech = new PostoSubcollectionRepository<FechamentoCaixa>('fechamentos');
const repoOcorr = new PostoSubcollectionRepository<OcorrenciaCaixa>('ocorrenciasCaixa');
const repoTanques = new PostoSubcollectionRepository<Tanque>('tanques');
const repoBicos = new PostoSubcollectionRepository<Bico>('bicos');
const repoAfericoes = new PostoSubcollectionRepository<Afericao>('afericoes');
const repoDensidades = new PostoSubcollectionRepository<RegistroDensidade>('densidades');
const repoConformidades = new PostoSubcollectionRepository<Conformidade>('conformidades');
const repoAuditoria = new PostoSubcollectionRepository<AuditLog>('auditoria');
const repoLMC = new PostoSubcollectionRepository<LMCRegistro>('lmc');
const repoRateio = new PostoSubcollectionRepository<RateioTurno>('rateios');
const repoEscalasImportadas = new PostoSubcollectionRepository<EscalaImportada>('escalasImportadas');

interface MenuItemDef {
  id: string;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  tag?: string;
  tagColor?: string;
  description: string;
}

interface MenuCategoryDef {
  title: string;
  items: MenuItemDef[];
}

const MENU_CATEGORIES: MenuCategoryDef[] = [
  {
    title: 'Início',
    items: [
      {
        id: 'dashboard',
        label: 'Visão geral',
        shortLabel: 'Início',
        icon: LayoutDashboard,
        description: 'Métricas em tempo real, tanques e status da pista',
      },
    ],
  },
  {
    title: 'Equipe',
    items: [
      {
        id: 'planner',
        label: 'Planner de escalas',
        shortLabel: 'Planner',
        icon: Calendar,
        description: 'Planejamento mensal e folgas da equipe',
      },
      {
        id: 'funcionarios',
        label: 'Funcionários',
        shortLabel: 'Funcionários',
        icon: Users,
        description: 'Cadastro de frentistas, cargos e turnos',
      },
      {
        id: 'ia-escala',
        label: 'Ler escala por foto',
        shortLabel: 'Ler escala',
        icon: Sparkles,
        description: 'OCR inteligente de fotos de folhas e quadros',
      },
    ],
  },
  {
    title: 'Rotina',
    items: [
      {
        id: 'fechamento',
        label: 'Fechamento de Caixa',
        shortLabel: 'Fechamento',
        icon: DollarSign,
        description: 'Conferência de encerrantes, cartões e dinheiro',
      },
      {
        id: 'sobras-faltas',
        label: 'Sobras e faltas',
        shortLabel: 'Rateio',
        icon: Scale,
        description: 'Divisão justa de divergências entre operadores',
      },
      {
        id: 'lmc',
        label: 'LMC — Movimentação',
        shortLabel: 'LMC',
        icon: BookOpen,
        description: 'Livro de Movimentação de Combustíveis ANP',
      },
    ],
  },
  {
    title: 'Pista e qualidade',
    items: [
      {
        id: 'tanques',
        label: 'Tanques & Régua',
        shortLabel: 'Tanques',
        icon: Fuel,
        description: 'Tabela de arqueação e cálculo de régua',
      },
      {
        id: 'afericoes',
        label: 'Bicos & Aferições',
        shortLabel: 'Aferições',
        icon: Gauge,
        description: 'Balde aferidor 20L e controle Inmetro',
      },
      {
        id: 'analises',
        label: 'Qualidade & ANP',
        shortLabel: 'Qualidade',
        icon: TestTubes,
        description: 'Testes de proveta D32, densidades e conformidade',
      },
    ],
  },
  {
    title: 'Relatórios',
    items: [
      {
        id: 'relatorios',
        label: 'Relatórios e histórico',
        shortLabel: 'Relatórios',
        icon: FileText,
        description: 'Exportação PDF/Excel e rastreabilidade total',
      },
    ],
  },
];

const ALL_MENU_ITEMS: MenuItemDef[] = MENU_CATEGORIES.flatMap((c) => c.items);

const MainApp: React.FC = () => {
  const {
    currentUser,
    userProfile,
    authError,
    postoId,
    usuariosCadastrados,
    signInWithGoogle,
    signInWithCredentials,
    registerAccess,
    signOut,
  } = useAuth();
  const { isOnline, syncState, pendingCount, ultimoPingNuvem, syncNow, storageDisponivel } = useSync();

  const [activeTab, setActiveTab] = useState('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [modalLimpezaAberto, setModalLimpezaAberto] = useState(false);
  const [limpandoDados, setLimpandoDados] = useState(false);
  const [toastSucesso, setToastSucesso] = useState('');

  // Estados da tela simplificada de Login e Cadastro de Acesso
  const [modoAcesso, setModoAcesso] = useState<'LOGIN' | 'CADASTRO'>('LOGIN');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginSenha, setLoginSenha] = useState('');
  const [cadastroNome, setCadastroNome] = useState('');
  const [cadastroEmail, setCadastroEmail] = useState('');
  const [cadastroSenha, setCadastroSenha] = useState('');
  const [erroAuth, setErroAuth] = useState('');
  const [autenticando, setAutenticando] = useState(false);

  // States dos dados operacionais reais em tempo real
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [escalas, setEscalas] = useState<Escala[]>([]);
  const [fechamentos, setFechamentos] = useState<FechamentoCaixa[]>([]);
  const [ocorrencias, setOcorrencias] = useState<OcorrenciaCaixa[]>([]);
  const [tanques, setTanques] = useState<Tanque[]>([]);
  const [bicos, setBicos] = useState<Bico[]>([]);
  const [afericoes, setAfericoes] = useState<Afericao[]>([]);
  const [densidades, setDensidades] = useState<RegistroDensidade[]>([]);
  const [conformidades, setConformidades] = useState<Conformidade[]>([]);
  const [auditoria, setAuditoria] = useState<AuditLog[]>([]);
  const [escalasImportadas, setEscalasImportadas] = useState<EscalaImportada[]>([]);
  const [registrosLMC, setRegistrosLMC] = useState<LMCRegistro[]>([]);

  // Turno operacional ao vivo baseado no relógio (Turno 1 = Manhã, Turno 2 = Tarde)
  const horaAtual = new Date().getHours();
  const turnoAtual =
    horaAtual < 14
      ? { nome: 'Turno 1 — Manhã', icone: Sunrise, cor: 'text-amber-400 bg-amber-950/40 border-amber-800/60' }
      : { nome: 'Turno 2 — Tarde', icone: Sun, cor: 'text-blue-600 bg-blue-950/40 border-blue-800/60' };

  const TurnoIcone = turnoAtual.icone;

  const currentTabDef = ALL_MENU_ITEMS.find((item) => item.id === activeTab) || ALL_MENU_ITEMS[0];
  const CurrentIcon = currentTabDef.icon;

  const carregarDadosNuvem = async () => {
    const [f, t, b, e, fc, oc, af, dn, cf, au, ei] = await Promise.all([
      repoFunc.getAll(postoId),
      repoTanques.getAll(postoId),
      repoBicos.getAll(postoId),
      repoEscalas.getAll(postoId),
      repoFech.getAll(postoId),
      repoOcorr.getAll(postoId),
      repoAfericoes.getAll(postoId),
      repoDensidades.getAll(postoId),
      repoConformidades.getAll(postoId),
      repoAuditoria.getAll(postoId),
      repoEscalasImportadas.getAll(postoId),
    ]);
    setFuncionarios(f);
    setTanques(t);
    setBicos(b);
    setEscalas(e);
    setFechamentos(fc);
    setOcorrencias(oc);
    setAfericoes(af);
    setDensidades(dn);
    setConformidades(cf);
    setAuditoria(au);
    setEscalasImportadas(ei);
  };

  const carregarDados = async () => {
    await carregarDadosNuvem();
  };

  // Função para remover todos os dados de demonstração e zerar as coleções na nuvem Firestore
  const handleRemoverDadosDemonstracao = async () => {
    setLimpandoDados(true);
    try {
      await Promise.all([
        repoFunc.clearAll(postoId),
        repoEscalas.clearAll(postoId),
        repoFech.clearAll(postoId),
        repoOcorr.clearAll(postoId),
        repoTanques.clearAll(postoId),
        repoBicos.clearAll(postoId),
        repoAfericoes.clearAll(postoId),
        repoDensidades.clearAll(postoId),
        repoConformidades.clearAll(postoId),
        repoAuditoria.clearAll(postoId),
        repoLMC.clearAll(postoId),
        repoRateio.clearAll(postoId),
      ]);

      if (typeof window !== 'undefined' && window.localStorage) {
        const chavesParaRemover: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.startsWith('meuposto_demo_') || key === 'meu_posto_sync_queue')) {
            chavesParaRemover.push(key);
          }
        }
        chavesParaRemover.forEach((k) => localStorage.removeItem(k));
      }

      setFuncionarios([]);
      setEscalas([]);
      setFechamentos([]);
      setOcorrencias([]);
      setTanques([]);
      setBicos([]);
      setAfericoes([]);
      setDensidades([]);
      setConformidades([]);
      setAuditoria([]);

      if (userProfile) {
        await registrarAuditoria(
          postoId,
          userProfile.uid,
          userProfile.nome,
          'SISTEMA',
          'BANCO_DE_DADOS_NUVEM',
          postoId,
          'DELETE',
          { acao: 'Limpeza completa de dados de demonstração na nuvem 24h' },
          null
        );
      }

      setModalLimpezaAberto(false);
      setToastSucesso('Dados de demonstração limpos na nuvem! Sistema pronto para operação real 24h.');
      setTimeout(() => setToastSucesso(''), 5000);
    } catch (err) {
      console.error('Erro ao remover dados de demonstração:', err);
      alert('Erro ao limpar dados na nuvem: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLimpandoDados(false);
    }
  };

  useEffect(() => {
    if (!userProfile) return;

    testConnection();

    // Conexão 24 horas em tempo real (onSnapshot) diretamente no Google Cloud Firestore
    const unFunc = repoFunc.subscribe(postoId, setFuncionarios);
    const unEsc = repoEscalas.subscribe(postoId, setEscalas);
    const unFech = repoFech.subscribe(postoId, setFechamentos);
    const unOcorr = repoOcorr.subscribe(postoId, setOcorrencias);
    const unTanq = repoTanques.subscribe(postoId, setTanques);
    const unBic = repoBicos.subscribe(postoId, setBicos);
    const unAfer = repoAfericoes.subscribe(postoId, setAfericoes);
    const unDens = repoDensidades.subscribe(postoId, setDensidades);
    const unConf = repoConformidades.subscribe(postoId, setConformidades);
    const unAud = repoAuditoria.subscribe(postoId, setAuditoria);
    const unEscImp = repoEscalasImportadas.subscribe(postoId, setEscalasImportadas);
    const unLMC = repoLMC.subscribe(postoId, setRegistrosLMC);

    return () => {
      unFunc();
      unEsc();
      unFech();
      unOcorr();
      unTanq();
      unBic();
      unAfer();
      unDens();
      unConf();
      unAud();
      unEscImp();
      unLMC();
    };
  }, [postoId, userProfile]);

  // Tela de Login Simplificada com Cadastro de Acesso Habilitado
  if (!userProfile) {
    const handleSubmeterLogin = async (e: React.FormEvent) => {
      e.preventDefault();
      setErroAuth('');
      setAutenticando(true);
      try {
        await signInWithCredentials(loginEmail, loginSenha);
      } catch (err: unknown) {
        setErroAuth(err instanceof Error ? err.message : 'Erro ao entrar.');
      } finally {
        setAutenticando(false);
      }
    };

    const handleSubmeterCadastro = async (e: React.FormEvent) => {
      e.preventDefault();
      setErroAuth('');
      setAutenticando(true);
      try {
        await registerAccess({
          nome: cadastroNome,
          email: cadastroEmail,
          senha: cadastroSenha,
        });
      } catch (err: unknown) {
        setErroAuth(err instanceof Error ? err.message : 'Erro ao cadastrar acesso.');
      } finally {
        setAutenticando(false);
      }
    };

    return (
      <div className="auth-essential min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 text-slate-900 font-sans">
        <div className="max-w-md w-full bg-white border border-slate-200 p-6 sm:p-7 rounded-2xl shadow-2xl space-y-5">
          {/* Cabeçalho Enxuto */}
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-md shrink-0">
              <Fuel className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-extrabold tracking-tight text-slate-900">MEU POSTO</h1>
                <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-blue-600 text-white uppercase">
                  2.0
                </span>
              </div>
              <p className="text-xs text-slate-500">Acesso ao Sistema Operacional</p>
            </div>
          </div>

          {/* Alternador Entrar / Cadastrar Acesso */}
          <div className="grid grid-cols-2 p-1 bg-slate-50 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => {
                setModoAcesso('LOGIN');
                setErroAuth('');
              }}
              className={`py-2 text-xs font-bold rounded-lg transition cursor-pointer ${
                modoAcesso === 'LOGIN'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-500 hover:text-blue-700'
              }`}
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => {
                setModoAcesso('CADASTRO');
                setErroAuth('');
              }}
              className={`py-2 text-xs font-bold rounded-lg transition cursor-pointer ${
                modoAcesso === 'CADASTRO'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-500 hover:text-blue-700'
              }`}
            >
              Cadastrar Acesso
            </button>
          </div>

          {/* Alerta de Erro ou Bloqueio de Acesso */}
          {(erroAuth || authError) && (
            <div className="p-3.5 rounded-xl bg-red-950/70 border border-red-800 text-red-200 text-xs flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{erroAuth || authError}</span>
              </div>
              {currentUser && (
                <button
                  type="button"
                  onClick={() => signOut()}
                  className="self-start text-[11px] underline text-red-300 hover:text-blue-700 cursor-pointer"
                >
                  Encerrar sessão de {currentUser.email}
                </button>
              )}
            </div>
          )}

          {modoAcesso === 'LOGIN' ? (
            <form onSubmit={handleSubmeterLogin} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">E-mail</label>
                <input
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="seu@email.com"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Senha</label>
                <input
                  type="password"
                  required
                  value={loginSenha}
                  onChange={(e) => setLoginSenha(e.target.value)}
                  placeholder="Digite sua senha"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <button
                type="submit"
                disabled={autenticando}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm rounded-xl transition shadow-md disabled:opacity-50 cursor-pointer"
              >
                {autenticando ? 'Entrando...' : 'Entrar no Sistema'}
              </button>

              <button
                type="button"
                onClick={signInWithGoogle}
                className="w-full py-2.5 px-4 bg-white hover:bg-slate-100 text-slate-900 font-semibold text-xs rounded-xl transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Entrar com Conta Google</span>
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmeterCadastro} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Nome Completo</label>
                <input
                  type="text"
                  required
                  value={cadastroNome}
                  onChange={(e) => setCadastroNome(e.target.value)}
                  placeholder="Ex: Carlos Eduardo"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">E-mail de Acesso</label>
                <input
                  type="email"
                  required
                  value={cadastroEmail}
                  onChange={(e) => setCadastroEmail(e.target.value)}
                  placeholder="carlos@meuposto.com"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Criar Senha</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={cadastroSenha}
                  onChange={(e) => setCadastroSenha(e.target.value)}
                  placeholder="Mín. 6 caracteres"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-[11px] text-slate-500">
                <span>Cadastro protegido: Novos colaboradores ingressam com perfil operacional. Cargos de gerência e supervisão são validados e promovidos internamente.</span>
              </div>

              <button
                type="submit"
                disabled={autenticando}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-slate-900 font-bold text-sm rounded-xl transition shadow-md disabled:opacity-50 cursor-pointer"
              >
                {autenticando ? 'Cadastrando...' : 'Criar Acesso e Entrar'}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell essential-theme min-h-screen bg-slate-50 flex flex-col md:flex-row text-slate-900 font-sans print:bg-white print:min-h-0">
      {/* 1. Sidebar Desktop/Tablet Ilustrada e Organizada por Categorias (Colapsável) */}
      <aside
        className={`hidden md:flex flex-col ${
          sidebarCollapsed ? 'w-20' : 'w-60'
        } app-sidebar bg-white text-slate-600 border-r border-slate-200 print:hidden shrink-0 transition-all duration-200 select-none`}
      >
        {/* Cabeçalho da Marca & Posto com botão para recolher */}
        <div className="p-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-600/30 font-bold shrink-0">
              <Fuel className="w-5 h-5" />
            </div>
            {!sidebarCollapsed && (
              <div className="min-w-0 flex-1">
                <div className="font-extrabold text-slate-900 text-sm tracking-wide flex items-center gap-1.5">
                  <span className="truncate">MEU POSTO</span>
                  <span className="text-[9px] font-black px-1.5 py-0.2 bg-blue-600 text-white rounded shrink-0">
                    2.0
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 truncate">Gestão operacional</div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? 'Expandir barra lateral' : 'Recolher para modo compacto'}
            className="p-1.5 hover:bg-slate-100 text-slate-500 hover:text-blue-700 rounded-lg transition shrink-0 cursor-pointer"
          >
            {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {/* Perfil do Usuário e Turno Ativo */}
        <div className="p-3 border-b border-slate-200 bg-slate-50 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 font-bold text-xs flex items-center justify-center shrink-0 border border-slate-200"
                title={`${userProfile.nome} (${userProfile.role})`}
              >
                {userProfile.nome.slice(0, 1).toUpperCase()}
              </div>
              {!sidebarCollapsed && (
                <div className="truncate min-w-0">
                  <div className="font-semibold text-xs text-slate-900 truncate">{userProfile.nome}</div>
                  <div className="text-[10px] text-blue-600 font-bold uppercase">{userProfile.role}</div>
                </div>
              )}
            </div>
            {!sidebarCollapsed && (
              <button
                onClick={signOut}
                title="Encerrar sessão"
                className="p-1.5 hover:bg-slate-100 text-slate-500 hover:text-blue-700 rounded-lg transition"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Chip do Turno Atual */}
          {!sidebarCollapsed ? (
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold border ${turnoAtual.cor}`}>
              <TurnoIcone className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{turnoAtual.nome}</span>
            </div>
          ) : (
            <div
              className="flex items-center justify-center p-1 rounded-lg border text-amber-400 border-slate-200"
              title={turnoAtual.nome}
            >
              <TurnoIcone className="w-3.5 h-3.5" />
            </div>
          )}
        </div>

        {/* Lista de Navegação por Categorias */}
        <nav className="flex-1 p-2 space-y-3 overflow-y-auto">
          {MENU_CATEGORIES.map((category) => (
            <div key={category.title} className="space-y-1">
              {!sidebarCollapsed && (
                <div className="px-3 pt-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  {category.title}
                </div>
              )}
              {category.items.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    aria-current={active ? 'page' : undefined}
                    title={item.label}
                    className={`w-full flex items-center ${
                      sidebarCollapsed ? 'justify-center p-2.5' : 'justify-between px-3 py-2.5'
                    } rounded-xl text-xs font-semibold transition active:scale-98 cursor-pointer ${
                      active
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'text-slate-500 hover:bg-blue-50 hover:text-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-slate-900' : 'text-slate-500'}`} />
                      {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                    </div>
                    {!sidebarCollapsed && item.tag && (
                      <span
                        className={`text-[9px] font-black px-1.5 py-0.5 rounded-full border shrink-0 ${
                          active
                            ? 'bg-white/20 text-slate-900 border-white/30'
                            : item.tagColor || 'bg-slate-100 text-slate-500 border-slate-200'
                        }`}
                      >
                        {item.tag}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}

          {/* Botão de Remoção de Dados de Demonstração */}
          <div className="pt-2 border-t border-slate-200">
            <button
              onClick={() => setModalLimpezaAberto(true)}
              className={`w-full flex items-center ${
                sidebarCollapsed ? 'justify-center p-2.5' : 'gap-2.5 px-3 py-2.5'
              } rounded-xl text-xs font-semibold text-red-400 hover:bg-red-500/10 hover:text-red-300 transition cursor-pointer`}
              title="Resetar banco de demonstração"
            >
              <Trash2 className="w-4 h-4 shrink-0" />
              {!sidebarCollapsed && <span>Remover Demonstração</span>}
            </button>
          </div>
        </nav>

        {/* Rodapé de Status de Rede e Sincronização na Nuvem */}
        <div className="p-3 border-t border-slate-200 bg-slate-50 text-[11px] space-y-2">
          <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'justify-between'}`}>
            <div className="flex items-center gap-1.5">
              {isOnline ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <WifiOff className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              )}
              {!sidebarCollapsed && (
                <span className={`text-[11px] font-medium ${isOnline ? 'text-slate-600' : 'text-rose-400'}`}>
                  {isOnline ? 'Conectado à Nuvem' : 'Modo Offline'}
                </span>
              )}
            </div>
            {!sidebarCollapsed && (
              <span className="text-[10px] font-mono text-slate-500 tabular-nums">
                {ultimoPingNuvem}
              </span>
            )}
          </div>

          {!sidebarCollapsed && pendingCount > 0 && (
            <button
              onClick={syncNow}
              className="w-full py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-semibold rounded-lg transition flex items-center justify-center gap-1 cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Sincronizar Fila Offline</span>
            </button>
          )}
        </div>
      </aside>

      {/* 2. Topbar Mobile Otimizada para Touch */}
      <header className="md:hidden bg-white/95 backdrop-blur-md text-slate-900 h-14 px-3.5 flex items-center justify-between sticky top-0 z-40 print:hidden border-b border-slate-200">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white shadow-xs shrink-0">
            <Fuel className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex items-center gap-1.5 truncate">
            <span className="font-extrabold text-xs tracking-wide">MEU POSTO</span>
            <span className="text-slate-500 text-xs" aria-hidden="true">·</span>
            <span className="text-xs font-semibold text-blue-600 truncate">
              {currentTabDef.shortLabel}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-1.5 text-xs text-slate-600 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200"
            title={isOnline ? 'Nuvem Conectada' : 'Offline'}
          >
            {isOnline ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
            ) : (
              <WifiOff className="w-3 h-3 text-rose-400 shrink-0" />
            )}
            <span className="text-[10px] font-medium text-slate-600">{isOnline ? 'Nuvem' : 'Offline'}</span>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Abrir Menu Completo"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center bg-slate-100 hover:bg-slate-200 active:scale-95 rounded-xl text-slate-700 transition cursor-pointer"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Drawer Mobile Moderno com Backdrop e Gestão Touch */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex print:hidden">
          {/* Backdrop escurecido */}
          <div
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
          />

          {/* Painel lateral deslizante */}
          <div className="relative w-80 max-w-[85vw] bg-white text-slate-700 h-full flex flex-col shadow-2xl border-r border-slate-200 z-10 animate-in slide-in-from-left duration-200">
            {/* Header do Drawer */}
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold">
                  <Fuel className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-xs text-slate-900">MEU POSTO 2.0</div>
                  <div className="text-[10px] text-slate-500">{userProfile.nome} ({userProfile.role})</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-500 hover:text-blue-700 rounded-lg hover:bg-slate-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Lista com scroll e alvos de toque generosos */}
            <div className="flex-1 p-3 space-y-4 overflow-y-auto">
              {MENU_CATEGORIES.map((category) => (
                <div key={category.title} className="space-y-1">
                  <div className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    {category.title}
                  </div>
                  {category.items.map((item) => {
                    const Icon = item.icon;
                    const active = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setActiveTab(item.id);
                          setMobileMenuOpen(false);
                        }}
                        className={`w-full min-h-[44px] flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition active:scale-98 cursor-pointer ${
                          active ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <Icon className={`w-4 h-4 ${active ? 'text-slate-900' : 'text-slate-500'}`} />
                          <span>{item.label}</span>
                        </div>
                        {item.tag && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
                            {item.tag}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}

              <div className="pt-2 border-t border-slate-200 space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setModalLimpezaAberto(true);
                  }}
                  className="w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-red-400 hover:bg-red-500/10 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Remover Demonstração</span>
                </button>

                <button
                  type="button"
                  onClick={signOut}
                  className="w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-blue-700 cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Encerrar Sessão</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Área Principal com Topbar de Atalhos Rápidos e Conteúdo */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Barra Superior Global Limpa e Funcional (Desktop/Tablet) */}
        <header className="hidden md:flex items-center justify-between px-6 py-3.5 bg-white border-b border-slate-200 print:hidden shrink-0">
          {/* Breadcrumb e Seção Atual */}
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-xs font-semibold text-slate-500">Meu Posto</span>
            <span className="text-xs text-slate-600" aria-hidden="true">/</span>
            <span className="font-bold text-sm text-slate-900 truncate">
              {currentTabDef.label}
            </span>
            <span className="text-slate-600 hidden lg:inline" aria-hidden="true">·</span>
            <span className="text-xs text-slate-500 hidden lg:inline truncate">
              {currentTabDef.description}
            </span>
          </div>

          {/* Lado Direito: Turno, Data e Status de Conexão */}
          <div className="flex items-center gap-3.5 text-xs shrink-0">
            <div className="hidden sm:flex items-center gap-1.5 text-slate-600 font-medium">
              <TurnoIcone className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span>{turnoAtual.nome}</span>
            </div>

            <span className="text-slate-700 hidden sm:inline" aria-hidden="true">|</span>

            <div className="flex items-center gap-1.5 font-medium">
              {isOnline ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="text-slate-600">Online</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                  <span className="text-rose-600 font-semibold">Offline</span>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Toast de Sucesso */}
        {toastSucesso && (
          <div className="fixed top-5 right-5 z-50 bg-emerald-700 text-slate-900 px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2 text-xs font-semibold animate-in fade-in duration-200">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{toastSucesso}</span>
          </div>
        )}

        {/* Modal de Confirmação de Remoção de Dados de Demonstração */}
        {modalLimpezaAberto && (
          <div className="fixed inset-0 z-50 bg-slate-50/70 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Remover Dados de Demonstração?</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Esta ação limpará permanentemente todos os registros de demonstração de funcionários, escalas, fechamentos, tanques e bicos do posto atual.
                  </p>
                </div>
              </div>

              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 text-xs text-slate-600 space-y-1">
                <p className="font-semibold text-slate-800">O que será zerado:</p>
                <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-slate-500">
                  <li>Funcionários e operadores cadastrados</li>
                  <li>Escalas de trabalho e planejamentos</li>
                  <li>Fechamentos de caixa e faltas registradas</li>
                  <li>Tanques de combustível e tabelas de régua</li>
                  <li>Bicos e histórico de aferições</li>
                  <li>Análises de densidade e checklists</li>
                </ul>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={limpandoDados}
                  onClick={() => setModalLimpezaAberto(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl transition"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={limpandoDados}
                  onClick={handleRemoverDadosDemonstracao}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-slate-900 font-semibold text-xs rounded-xl transition shadow-xs disabled:opacity-50"
                >
                  {limpandoDados ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Limpando dados...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      Confirmar e Limpar Tudo
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Conteúdo Principal Renderizado */}
        <main id="conteudo-principal" tabIndex={-1} className="flex-1 p-3 sm:p-5 md:p-8 pb-24 md:pb-8 overflow-y-auto max-w-7xl mx-auto w-full print:p-0 print:m-0 print:max-w-none print:overflow-visible">
          <ModuleErrorBoundary key={activeTab}>
          <Suspense fallback={<div role="status" aria-live="polite" className="flex min-h-48 items-center justify-center gap-3 text-slate-500"><Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />Carregando módulo…</div>}>
          {activeTab === 'dashboard' && (
            <DashboardView
              funcionarios={funcionarios}
              escalas={escalas}
              fechamentos={fechamentos}
              ocorrencias={ocorrencias}
              tanques={tanques}
              bicos={bicos}
              afericoes={afericoes}
              densidades={densidades}
              conformidades={conformidades}
              escalasImportadas={escalasImportadas}
              registrosLMC={registrosLMC}
              onNavigate={(aba) => setActiveTab(aba)}
            />
          )}

          {activeTab === 'funcionarios' && (
            <FuncionariosView funcionarios={funcionarios} onReload={carregarDados} />
          )}

          {activeTab === 'fechamento' && (
            <FechamentoCaixaView
              fechamentos={fechamentos}
              ocorrencias={ocorrencias}
              funcionarios={funcionarios}
              escalas={escalas}
              bicos={bicos}
              tanques={tanques}
              onReload={carregarDados}
            />
          )}

          {activeTab === 'sobras-faltas' && (
            <SobrasFaltasView
              escalas={escalas}
              funcionarios={funcionarios}
              fechamentos={fechamentos}
              onReload={carregarDados}
            />
          )}

          {activeTab === 'planner' && (
            <PlannerView
              escalas={escalas}
              funcionarios={funcionarios}
              escalasImportadas={escalasImportadas}
              onReload={carregarDados}
              onNavigateToIAEscala={() => setActiveTab('ia-escala')}
            />
          )}

          {activeTab === 'lmc' && (
            <LMCView
              tanques={tanques}
              bicos={bicos}
              fechamentos={fechamentos}
              onReload={carregarDados}
            />
          )}

          {activeTab === 'tanques' && <TanquesView tanques={tanques} onReload={carregarDados} />}

          {activeTab === 'afericoes' && (
            <BicosAfericoesView
              bicos={bicos}
              afericoes={afericoes}
              tanques={tanques}
              funcionarios={funcionarios}
              onReload={carregarDados}
            />
          )}

          {activeTab === 'analises' && (
            <AnalisesConformidadeView
              densidades={densidades}
              conformidades={conformidades}
              funcionarios={funcionarios}
              onReload={carregarDados}
            />
          )}

          {activeTab === 'relatorios' && (
            <RelatoriosView
              funcionarios={funcionarios}
              escalas={escalas}
              fechamentos={fechamentos}
              ocorrencias={ocorrencias}
              tanques={tanques}
              bicos={bicos}
              afericoes={afericoes}
              densidades={densidades}
              conformidades={conformidades}
              auditoria={auditoria}
              onLimparDemonstracao={() => setModalLimpezaAberto(true)}
            />
          )}

          {activeTab === 'ia-escala' && (
            <IAEscalaView
              funcionarios={funcionarios}
              escalas={escalas}
              escalasImportadas={escalasImportadas}
              onReload={carregarDados}
              onNavigateToPlanner={() => setActiveTab('planner')}
            />
          )}
          </Suspense>
          </ModuleErrorBoundary>
        </main>

        <nav aria-label="Navegação principal" className="essential-bottom-nav md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 px-3 py-2 grid grid-cols-4 print:hidden pb-safe">
          {[{ id: 'dashboard', label: 'Início', icon: LayoutDashboard }, { id: 'planner', label: 'Planner', icon: Calendar }, { id: 'funcionarios', label: 'Equipe', icon: Users }].map((item) => (
            <button key={item.id} type="button" aria-current={activeTab === item.id ? 'page' : undefined}
              onClick={() => { setActiveTab(item.id); setMobileMenuOpen(false); }}
              className={`min-h-12 flex flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold transition ${activeTab === item.id ? 'bg-blue-50 text-blue-600' : 'text-slate-500 hover:bg-slate-50'}`}>
              <item.icon className="h-5 w-5" /><span>{item.label}</span>
            </button>
          ))}
          <button type="button" aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen(true)} className="min-h-12 flex flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold text-slate-500 hover:bg-slate-50"><Menu className="h-5 w-5" /><span>Mais</span></button>
        </nav>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <SyncProvider>
        <MainApp />
      </SyncProvider>
    </AuthProvider>
  );
}
