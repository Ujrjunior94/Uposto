import React from "react";
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

export const DashboardView: React.FC<DashboardProps> = ({
  funcionarios,
  escalas,
  fechamentos,
  tanques,
  afericoes,
  conformidades,
  onNavigate,
}) => {
  const now = new Date();
  // Operational dates follow the local calendar, including the hours before midnight in Brazil.
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const workers = funcionarios.filter((f) => f.status === "ATIVO");
  const working = escalas.filter(
    (e) => e.data === today && ["TRABALHO", "PLANTAO"].includes(e.status),
  );
  const pending = conformidades.filter((c) =>
    ["PENDENTE", "NAO_CONFORME"].includes(c.status),
  ).length;
  const closed = fechamentos.filter((f) => f.data === today).length;
  const team = Array.from(
    new Map<string, Escala>(working.map((e) => [e.funcionarioId, e])).values(),
  );
  const metrics = [
    {
      label: "Escalados hoje",
      value: team.length,
      detail: `${workers.length} funcionários ativos`,
      icon: Users,
      color: "text-blue-600 bg-blue-50",
    },
    {
      label: "Fechamentos hoje",
      value: closed,
      detail: "Registros de conferência",
      icon: ClipboardCheck,
      color: "text-emerald-600 bg-emerald-50",
    },
    {
      label: "Aferições hoje",
      value: afericoes.filter((a) => a.data === today).length,
      detail: "Verificações registradas",
      icon: Gauge,
      color: "text-violet-600 bg-violet-50",
    },
    {
      label: "Pendências de qualidade",
      value: pending,
      detail: "Análises para acompanhar",
      icon: CheckCircle2,
      color: pending
        ? "text-amber-700 bg-amber-50"
        : "text-slate-600 bg-slate-100",
    },
  ];
  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="section-eyebrow">
            {now.toLocaleDateString("pt-BR", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </p>
          <h1 className="page-title">Sua operação, mais simples.</h1>
          <p className="page-description">
            Equipe, rotina e qualidade em um só lugar.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate("ia-escala")}
          className="action-primary"
        >
          <Camera className="h-4 w-4" />
          Ler escala por foto
        </button>
      </div>
      <section
        aria-label="Resumo da operação"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"
          >
            <div
              className={`mb-4 inline-flex rounded-xl p-2.5 ${metric.color}`}
            >
              <metric.icon className="h-5 w-5" />
            </div>
            <p className="text-xs font-medium text-slate-500">{metric.label}</p>
            <p className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
              {metric.value}
            </p>
            <p className="mt-2 text-xs text-slate-400">{metric.detail}</p>
          </div>
        ))}
      </section>
      <section className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 p-5">
            <h2 className="text-sm font-bold text-slate-900">Equipe de hoje</h2>
            <button
              type="button"
              onClick={() => onNavigate("planner")}
              className="flex items-center gap-1 text-xs font-semibold text-blue-700"
            >
              Ver Planner
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          {team.length ? (
            <ul className="divide-y divide-slate-100">
              {team.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-5 py-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">
                    {(
                      e.funcionarioNome ||
                      funcionarios.find((f) => f.id === e.funcionarioId)
                        ?.nome ||
                      "?"
                    ).slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {e.funcionarioNome ||
                        funcionarios.find((f) => f.id === e.funcionarioId)
                          ?.nome ||
                        "Funcionário"}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {e.turno}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-medium tabular-nums text-slate-500">
                    {e.horarioInicio}–{e.horarioFim}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-6 py-12 text-center">
              <CalendarDays className="mx-auto mb-3 h-8 w-8 text-slate-300" />
              <p className="text-sm font-medium text-slate-600">
                Nenhum trabalho escalado para hoje
              </p>
              <p className="mx-auto mt-2 max-w-xs text-xs leading-6 text-slate-400">
                Abra o Planner para conferir os registros ou importar uma
                escala.
              </p>
              <button
                type="button"
                onClick={() => onNavigate("planner")}
                className="action-secondary mt-4"
              >
                Organizar escala
              </button>
            </div>
          )}
        </div>
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="mb-4 text-sm font-bold text-slate-900">
              O que você precisa fazer?
            </h2>
            <div className="space-y-1">
              {[
                {
                  label: "Conferir fechamento",
                  text: "Registrar a conferência do turno",
                  icon: ClipboardCheck,
                  tab: "fechamento",
                },
                {
                  label: "Ver sobras e faltas",
                  text: "Acompanhar divergências registradas",
                  icon: Gauge,
                  tab: "sobras-faltas",
                },
                {
                  label: "Consultar tanques",
                  text: `${tanques.filter((t) => t.ativo).length} tanques ativos`,
                  icon: Fuel,
                  tab: "tanques",
                },
              ].map((action) => (
                <button
                  type="button"
                  key={action.tab}
                  onClick={() => onNavigate(action.tab)}
                  className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:bg-slate-50"
                >
                  <action.icon className="h-5 w-5 shrink-0 text-slate-400" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-700">
                      {action.label}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">{action.text}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-slate-300" />
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate("analises")}
            className={`flex w-full items-center justify-between gap-3 rounded-2xl border p-5 text-left ${pending ? "border-amber-200 bg-amber-50" : "border-emerald-100 bg-emerald-50"}`}
          >
            <div>
              <p className="text-sm font-semibold text-slate-800">
                {pending
                  ? `${pending} pendências de qualidade`
                  : "Nenhuma pendência registrada"}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Consultar análises e conformidade
              </p>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-slate-500" />
          </button>
        </div>
      </section>
    </div>
  );
};
