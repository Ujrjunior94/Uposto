import React from "react";
import { useAuth } from "../../contexts/AuthContext";
import {
  ArrowRight,
  CalendarDays,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Fuel,
  Gauge,
  Users,
} from "lucide-react";
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
  EscalaImportada,
  LMCRegistro,
} from "../../types";

interface DashboardProps {
  funcionarios: Funcionario[];
  escalas: Escala[];
  fechamentos: FechamentoCaixa[];
  ocorrencias: OcorrenciaCaixa[];
  tanques: Tanque[];
  bicos?: Bico[];
  afericoes: Afericao[];
  densidades: RegistroDensidade[];
  conformidades: Conformidade[];
  escalasImportadas?: EscalaImportada[];
  registrosLMC?: LMCRegistro[];
  onNavigate: (aba: string) => void;
}

export const DashboardView: React.FC<DashboardProps> = ({ funcionarios, escalas, conformidades, onNavigate }) => {
  const { userProfile } = useAuth();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const team = Array.from(new Map<string, Escala>(escalas.filter(e => e.data === today && ['TRABALHO', 'PLANTAO'].includes(e.status) && !/folga|f[eé]rias|afastamento/i.test(e.turno || '')).map(e => [e.funcionarioId, e] as [string, Escala])).values());
  const pending = conformidades.filter(c => ['PENDENTE', 'NAO_CONFORME'].includes(c.status)).length;
  return <div className="essential-dashboard mx-auto max-w-5xl space-y-6 sm:space-y-8">
    <section className="flex items-start justify-between gap-4">
      <div><p className="text-2xl font-extrabold tracking-tight text-slate-900">Olá, {userProfile?.nome?.split(' ')[0] || 'bem-vindo'}</p><p className="mt-2 text-sm text-slate-500 capitalize">{now.toLocaleDateString('pt-BR', {weekday:'long',day:'numeric',month:'long'})}</p></div>
      <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-600 text-lg font-bold text-white">{userProfile?.nome?.slice(0,1) || 'M'}</span>
    </section>
    <section aria-labelledby="overview-title" className="space-y-4">
      <h1 id="overview-title" className="text-lg font-bold text-slate-900">Visão geral</h1>
      <div className="grid grid-cols-2 gap-3 sm:gap-5">
        <button onClick={()=>onNavigate('planner')} className="essential-card flex min-h-24 items-center gap-3 p-4 text-left sm:p-6"><span className="rounded-xl bg-blue-50 p-3 text-blue-600"><Users className="h-6 w-6" /></span><span><strong className="block text-3xl font-bold text-slate-900">{team.length}</strong><span className="text-xs text-slate-500">na escala hoje</span></span></button>
        <button onClick={()=>onNavigate('analises')} className="essential-card flex min-h-24 items-center gap-3 p-4 text-left sm:p-6"><span className={`rounded-xl p-3 ${pending ? 'bg-orange-50 text-orange-600' : 'bg-emerald-50 text-emerald-600'}`}><ClipboardCheck className="h-6 w-6" /></span><span><strong className="block text-3xl font-bold text-slate-900">{pending}</strong><span className="text-xs text-slate-500">pendências</span></span></button>
      </div>
      <button onClick={()=>onNavigate('ia-escala')} className="action-primary w-full justify-between shadow-sm shadow-blue-100 min-h-14"><span className="flex items-center gap-3"><Camera className="h-5 w-5" />Ler escala por foto</span><ArrowRight className="h-5 w-5" /></button>
    </section>
    <section aria-labelledby="team-title" className="space-y-3">
      <div className="flex items-center justify-between"><h2 id="team-title" className="text-lg font-bold text-slate-900">Equipe de hoje</h2><button onClick={()=>onNavigate('planner')} className="min-h-11 px-2 text-sm font-semibold text-blue-600">Ver todos</button></div>
      {team.length ? <ul className="grid gap-3 lg:grid-cols-2">{team.map((e,index)=>{
        const name=e.funcionarioNome || funcionarios.find(f=>f.id===e.funcionarioId)?.nome || 'Funcionário';
        const colors=['bg-blue-50 text-blue-600','bg-emerald-50 text-emerald-600','bg-violet-50 text-violet-600'];
        return <li key={e.id}><button onClick={()=>onNavigate('planner')} className="essential-card flex w-full items-center gap-3 p-4 text-left hover:border-blue-200"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-bold ${colors[index%3]}`}>{name.slice(0,1)}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-slate-900">{name}</span><span className="mt-1 block text-xs text-slate-500">{e.turno} · {e.horarioInicio}–{e.horarioFim}</span></span><ArrowRight className="h-4 w-4 shrink-0 text-slate-400" /></button></li>;
      })}</ul> : <div className="essential-card p-8 text-center"><CalendarDays className="mx-auto mb-3 h-7 w-7 text-blue-400" /><p className="text-sm text-slate-500">Nenhum trabalho escalado para hoje.</p><button className="action-secondary mt-4" onClick={()=>onNavigate('planner')}>Abrir Planner</button></div>}
    </section>
    <section aria-labelledby="routine-title" className="space-y-4"><h2 id="routine-title" className="text-lg font-bold text-slate-900">Rotina do posto</h2><div className="grid grid-cols-3 gap-2 sm:gap-4">{[
      {tab:'afericoes',label:'Aferições',icon:Gauge,color:'bg-blue-50 text-blue-700'},
      {tab:'analises',label:'Qualidade',icon:CheckCircle2,color:'bg-emerald-50 text-emerald-700'},
      {tab:'relatorios',label:'Relatórios',icon:ClipboardCheck,color:'bg-violet-50 text-violet-700'},
    ].map(item=><button key={item.tab} onClick={()=>onNavigate(item.tab)} className={`min-h-24 rounded-2xl p-3 text-left transition hover:brightness-95 sm:p-5 ${item.color}`}><item.icon className="mb-3 h-6 w-6" /><span className="flex items-center justify-between gap-1 text-xs font-semibold sm:text-sm">{item.label}<ArrowRight className="h-3.5 w-3.5" /></span></button>)}</div></section>
  </div>;
};
