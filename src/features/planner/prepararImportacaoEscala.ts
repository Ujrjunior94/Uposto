import type { Escala, EscalaStatus, Funcionario } from "../../types";
import { revalidarRegistrosEscala, TURNOS_PADRAO_POSTO, type RegistroImportadoReconhecido } from "./importadorEscalaImagemService";
import { conferirMatrizImportacao, type EscopoImportacaoEscala } from "./integridadeImportacaoEscala";

/** Build a write plan without changing the database. Reuse IDs already present in the Planner. */
export function prepararImportacaoEscala(
  records: RegistroImportadoReconhecido[],
  employees: Funcionario[],
  existing: Escala[],
  postoId: string,
  period: string,
  now = new Date().toISOString(),
  scope?: EscopoImportacaoEscala,
) {
  if (!postoId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || !records.length)
    throw new Error("Selecione um posto, período e células válidas.");
  const [year, month] = period.split("-").map(Number);
  const days = new Date(year, month, 0).getDate();
  const eligible = employees.filter(f => f.status !== "INATIVO" && (!f.postoId || f.postoId === postoId));
  const manifest = scope || { funcionarioIds: eligible.map(f => f.id), primeiroDia: 1, ultimoDia: days };
  if (manifest.funcionarioIds.some(id => !eligible.some(f => f.id === id)))
    throw new Error("Confira os funcionários e o posto desta importação.");
  // Recheck edited values at the write boundary; a stale CONFIRMADO flag is not evidence.
  const checked = revalidarRegistrosEscala(records, eligible, TURNOS_PADRAO_POSTO, days);
  const integrity = conferirMatrizImportacao(checked, manifest, days);
  if (integrity.limiteExcedido)
    throw new Error("A importação deve ter até 400 células para gravar tudo de uma vez. Declare um período menor do documento e confira todas as células desse período.");
  if (!integrity.completa)
    throw new Error(`Importação incompleta ou pendente: ${integrity.recebidos} de ${integrity.esperados} células; ${integrity.faltantes.length} faltantes, ${integrity.duplicadas} duplicadas e ${integrity.pendentes} pendentes. Confira a equipe, o período e cada célula antes de salvar.`);
  const replaced: Escala[] = [];
  const seen = new Set<string>();
  const updates: Escala[] = checked.map((r) => {
    const employee = eligible.find(
      (f) => f.id === r.employeeId && f.status !== "INATIVO",
    );
    if (
      r.status !== "CONFIRMADO" ||
      !employee ||
      !r.shiftId ||
      !Number.isInteger(r.day) ||
      r.day < 1 ||
      r.day > days
    )
      throw new Error(
        "Existem células pendentes. Confira a leitura antes de salvar.",
      );
    const date = `${period}-${String(r.day).padStart(2, "0")}`;
    const key = `${employee.id}_${date}`;
    if (seen.has(key))
      throw new Error(
        `Duas células para ${employee.nome} no dia ${r.day}. Remova a duplicata.`,
      );
    seen.add(key);
    const matches = existing.filter(
      (e) => (!e.postoId || e.postoId === postoId) && e.funcionarioId === employee.id && e.data === date,
    );
    if (matches.length > 1)
      throw new Error(
        `Já existem registros duplicados para ${employee.nome} em ${date}. Corrija-os no Planner antes de importar.`,
      );
    if (matches[0]) replaced.push(matches[0]);
    const status: EscalaStatus =
      r.shiftId === "FOLGA"
        ? "FOLGA"
        : r.shiftId === "FERIAS"
          ? "FERIAS"
          : r.shiftId === "ATESTADO"
            ? "AFASTADO"
            : r.shiftId === "AUSENTE"
              ? "AUSENTE"
              : "TRABALHO";
    return {
      ...(matches[0] || {}),
      id: matches[0]?.id || key,
      postoId,
      funcionarioId: employee.id,
      funcionarioNome: employee.nome,
      data: date,
      turno: r.shiftId === "FOLGA" ? "Folga" : r.shiftId,
      horarioInicio: r.horarioInicio,
      horarioFim: r.horarioFim,
      funcao: employee.funcao || employee.cargo || "",
      setor: employee.setor || "",
      status,
      origem: "IMAGEM",
      codigoOriginal: r.rawShiftText,
      statusConferencia: "CONFIRMADO",
      observacao: "Importação por imagem conferida pelo usuário.",
      criadoEm: matches[0]?.criadoEm || now,
      atualizadoEm: now,
    };
  });
  return { updates, replaced };
}
