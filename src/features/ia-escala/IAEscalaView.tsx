import React, { useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Camera,
  CheckCheck,
  ScanLine,
  Users,
} from "lucide-react";
import { Funcionario, Escala, EscalaImportada } from "../../types";
import { ModalImportarEscalaImagem } from "../planner/ModalImportarEscalaImagem";

interface Props {
  funcionarios: Funcionario[];
  escalas?: Escala[];
  escalasImportadas?: EscalaImportada[];
  onReload: () => void;
  onNavigateToPlanner?: () => void;
}

export const IAEscalaView: React.FC<Props> = ({
  funcionarios,
  escalas = [],
  onReload,
  onNavigateToPlanner,
}) => {
  const now = new Date();
  const [month, setMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
  );
  const [open, setOpen] = useState(false);
  const [success, setSuccess] = useState(false);
  const periodValid = /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  const [year, monthNumber] = month.split("-").map(Number);
  const active = funcionarios.filter((f) => f.status !== "INATIVO");
  const scheduled = new Set(
    escalas.filter((e) => e.data.startsWith(month)).map((e) => e.funcionarioId),
  ).size;
  return (
    <div className="space-y-6">
      <div>
        <p className="section-eyebrow">Equipe e escala</p>
        <h1 className="page-title">Da foto para o Planner</h1>
        <p className="page-description">
          Envie a escala, confira a leitura e salve os turnos da equipe.
        </p>
      </div>
      {success && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
        >
          <span>Escala conferida e salva no Planner.</span>
          <button
            type="button"
            onClick={onNavigateToPlanner}
            className="font-semibold underline"
          >
            Abrir Planner
          </button>
        </div>
      )}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.4fr_1fr] lg:p-10">
          <div>
            <div className="mb-5 inline-flex rounded-2xl bg-blue-50 p-3 text-blue-600">
              <ScanLine className="h-7 w-7" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">
              Uma foto. Todos os dias.
            </h2>
            <p className="mt-3 max-w-lg text-sm leading-7 text-slate-500">
              A foto precisa mostrar os nomes, os dias e os turnos. Você poderá
              corrigir cada célula antes de confirmar. A leitura não preenche o
              mês por suposição.
            </p>
            <div className="mt-7 flex flex-wrap items-end gap-3">
              <label className="block text-xs font-semibold text-slate-600">
                Mês da escala
                <input
                  type="month"
                  value={month}
                  onChange={(e) => {
                    setMonth(e.target.value);
                    setSuccess(false);
                  }}
                  className="field-control mt-2"
                />
              </label>
              <button
                type="button"
                disabled={!periodValid || !active.length}
                onClick={() => {
                  setSuccess(false);
                  setOpen(true);
                }}
                className="action-primary"
              >
                <Camera className="h-4 w-4" />
                Enviar foto da escala
              </button>
            </div>
            {!active.length && (
              <p className="mt-3 text-sm text-amber-700">
                Cadastre os funcionários na aba Equipe antes de começar.
              </p>
            )}
          </div>
          <ol className="space-y-5 rounded-2xl bg-slate-50 p-6">
            {[
              {
                icon: Camera,
                title: "Envie a imagem completa",
                text: "Use uma foto nítida ou uma captura de tela.",
              },
              {
                icon: CheckCheck,
                title: "Confira nomes e turnos",
                text: "Dúvidas ficam destacadas para sua revisão.",
              },
              {
                icon: CalendarDays,
                title: "Confirme no Planner",
                text: "Somente as células conferidas são importadas.",
              },
            ].map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-500">
                  0{index + 1}
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">
                    {step.title}
                  </h3>
                  <p className="mt-1 text-xs leading-6 text-slate-500">
                    {step.text}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-slate-100 px-6 py-4 text-xs text-slate-500 sm:px-8">
          <span className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            {active.length} funcionários cadastrados
          </span>
          <span className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            {scheduled} com registros no mês
          </span>
          <button
            type="button"
            onClick={onNavigateToPlanner}
            className="ml-auto flex items-center gap-2 font-semibold text-blue-700"
          >
            Abrir Planner
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </section>
      <p className="text-xs leading-6 text-slate-500">
        Escalas 5x2 e 12x36 não são aplicadas automaticamente. Nenhuma regra
        será usada para inventar dias que não estejam legíveis na imagem.
      </p>
      {periodValid && (
        <ModalImportarEscalaImagem
          isOpen={open}
          onClose={() => setOpen(false)}
          funcionarios={funcionarios}
          anoMesAtual={month}
          currentDate={new Date(year, monthNumber - 1, 1)}
          onSuccess={() => {
            setSuccess(true);
            onReload();
          }}
        />
      )}
    </div>
  );
};
