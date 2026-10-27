import { LeituraEscalaGratuita } from "./LeituraEscalaGratuita";
import { LeituraEscalaCores } from './LeituraEscalaCores';
import { prepararImportacaoEscala } from "./prepararImportacaoEscala";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Check,
  ImagePlus,
  Loader2,
  Plus,
  RotateCw,
  Trash2,
  X,
  AlertTriangle,
} from "lucide-react";
import { Funcionario, Escala } from "../../types";
import { useAuth } from "../../contexts/AuthContext";
import { PostoSubcollectionRepository } from "../../repositories/firestoreRepository";
import {
  TURNOS_PADRAO_POSTO,
  RegistroImportadoReconhecido,
  revalidarRegistrosEscala,
  salvarSnapshotImportacao,
} from "./importadorEscalaImagemService";

const repoEscala = new PostoSubcollectionRepository<Escala>("escalas");
const STATUS_OPTIONS = [
  { id: "FOLGA", label: "Folga" },
  { id: "FERIAS", label: "Férias" },
  { id: "ATESTADO", label: "Afastado" },
  { id: "AUSENTE", label: "Falta" },
];
const SHIFT_OPTIONS = TURNOS_PADRAO_POSTO.filter(
  (t) => !["Folga", "Férias"].includes(t.id),
);

interface Props {
  isOpen: boolean;
  onClose: () => void;
  funcionarios: Funcionario[];
  anoMesAtual: string;
  currentDate: Date;
  onSuccess: () => void;
}

export const ModalImportarEscalaImagem: React.FC<Props> = ({
  isOpen,
  onClose,
  funcionarios,
  anoMesAtual,
  onSuccess,
}) => {
  const { postoId } = useAuth();
  const [localMode, setLocalMode] = useState(true);
  const [image, setImage] = useState("");
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [records, setRecords] = useState<RegistroImportadoReconhecido[]>([]);
  const [search, setSearch] = useState("");
  const [onlyPending, setOnlyPending] = useState(false);
  const [approved, setApproved] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const fileVersion = useRef(0);
  const saveLock = useRef(false);
  const [year, month] = anoMesAtual.split("-").map(Number);
  const days = new Date(year, month, 0).getDate();
  const activeEmployees = useMemo(
    () => funcionarios.filter((f) => f.status !== "INATIVO"),
    [funcionarios],
  );
  const validated = useMemo(
    () =>
      revalidarRegistrosEscala(
        records,
        activeEmployees,
        TURNOS_PADRAO_POSTO,
        days,
      ),
    [records, activeEmployees, days],
  );
  const pending = validated.filter((r) => r.status !== "CONFIRMADO").length;
  const employeeCount = new Set(
    validated.map((r) => r.employeeId || r.rawEmployeeText),
  ).size;
  const visible = validated.filter(
    (r) =>
      (!onlyPending || r.status !== "CONFIRMADO") &&
      `${r.employeeName} ${r.rawEmployeeText}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );

  useEffect(() => {
    if (!isOpen) return;
    setImage("");
    setRecords([]);
    setError("");
    setApproved(false);
    setRotation(0);
    setSearch("");
    setOnlyPending(false);
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      requestRef.current?.abort();
      fileVersion.current++;
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [isOpen]);

  function update(id: string, changes: Partial<RegistroImportadoReconhecido>) {
    setApproved(false);
    setRecords((old) =>
      old.map((r) => (r.id === id ? { ...r, ...changes } : r)),
    );
  }

  async function loadFile(file?: File) {
    if (!file) return;
    setError("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Envie uma imagem JPG, PNG ou WebP.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError(
        "A foto deve ter até 20 MB. Recorte apenas a tabela e tente novamente.",
      );
      return;
    }
    const version = ++fileVersion.current;
    setPreparing(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () =>
          reject(new Error("Não foi possível abrir a imagem."));
        reader.readAsDataURL(file);
      });
      if (version !== fileVersion.current) return;
      setImage(data);
      setRecords([]);
      setApproved(false);
      setRotation(0);
    } catch (err: any) {
      if (version === fileVersion.current) setError(err.message);
    } finally {
      setPreparing(false);
    }
  }

  async function rotate() {
    if (!image || preparing) return;
    setPreparing(true);
    setError("");
    try {
      const img = new Image();
      img.src = image;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.height;
      canvas.height = img.width;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Não foi possível girar a foto.");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      setImage(canvas.toDataURL("image/jpeg", 0.95));
      setRotation((rotation + 90) % 360);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPreparing(false);
    }
  }


  async function save() {
    if (
      saveLock.current ||
      !approved ||
      !validated.length ||
      pending > 0 ||
      !postoId
    )
      return;
    saveLock.current = true;
    setSaving(true);
    setError("");
    try {
      // Read failures must abort the import, never masquerade as an empty Planner.
      const existing = await repoEscala.getAllStrict(postoId);
      const { updates, replaced } = prepararImportacaoEscala(
        validated,
        activeEmployees,
        existing,
        postoId,
        anoMesAtual,
      );
      salvarSnapshotImportacao(
        postoId,
        anoMesAtual,
        replaced,
        updates.map((r) => r.id),
      );
      await repoEscala.saveBatch(postoId, updates);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || "Não foi possível salvar. Confira sua conexão.");
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  function trapFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !saving && !reading) {
      event.stopPropagation();
      onClose();
    }
    if (event.key !== "Tab") return;
    const nodes: HTMLElement[] = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]",
      ) || [],
    );
    const first = nodes[0],
      last = nodes[nodes.length - 1];
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        document.activeElement === dialogRef.current)
    ) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:p-5">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        tabIndex={-1}
        onKeyDown={trapFocus}
        className="flex h-full max-h-[95dvh] w-full max-w-6xl flex-col overflow-hidden rounded-none bg-slate-50 shadow-2xl sm:rounded-2xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white p-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold text-blue-600">
              {records.length
                ? "2. Conferir e importar"
                : "1. Enviar uma imagem"}
            </p>
            <h2
              id="import-title"
              className="mt-1 text-lg font-bold text-slate-900"
            >
              Ler escala · {String(month).padStart(2, "0")}/{year}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Fechar leitura de escala"
            disabled={saving || reading}
            onClick={onClose}
            className="rounded-xl p-3 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="flex-1 overflow-auto p-4 sm:p-6">
          {error && (
            <div
              role="alert"
              className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
            >
              {error}
            </div>
          )}
          {!records.length ? (
            <div className="mx-auto max-w-2xl space-y-5">
              <div
                className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!reading) void loadFile(e.dataTransfer.files[0]);
                }}
              >
                {image ? (
                  <img
                    src={image}
                    alt="Foto da escala selecionada"
                    className="mx-auto max-h-80 rounded-lg object-contain"
                  />
                ) : (
                  <div className="py-8">
                    <ImagePlus className="mx-auto mb-4 h-10 w-10 text-blue-500" />
                    <h3 className="text-base font-semibold text-slate-900">
                      Envie a foto da escala completa
                    </h3>
                    <p className="mt-2 text-sm text-slate-500">
                      Inclua os nomes, o cabeçalho dos dias e a última coluna.
                      <br />
                      JPG, PNG ou WebP · até 20 MB
                    </p>
                  </div>
                )}
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    disabled={reading || preparing}
                    onClick={() => fileRef.current?.click()}
                    className="action-secondary"
                  >
                    <ImagePlus className="h-4 w-4" />
                    {image ? "Trocar foto" : "Escolher foto"}
                  </button>
                  <button
                    type="button"
                    disabled={reading || preparing}
                    onClick={() => cameraRef.current?.click()}
                    className="action-secondary"
                  >
                    <Camera className="h-4 w-4" />
                    Câmera
                  </button>
                  {image && (
                    <button
                      type="button"
                      disabled={reading || preparing}
                      onClick={rotate}
                      className="action-secondary"
                    >
                      <RotateCw className="h-4 w-4" />
                      Girar
                    </button>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    void loadFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <input
                  ref={cameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    void loadFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </div>
              <div className="space-y-3"><div className="grid grid-cols-2 gap-2"><button type="button" disabled={reading} aria-pressed={localMode} className={localMode?'action-primary':'action-secondary'} onClick={()=>{setLocalMode(true);setError('')}}>Foto ou tabela · grátis</button><button type="button" disabled={reading || !image} aria-pressed={!localMode} className={!localMode?'action-primary':'action-secondary'} onClick={()=>{setLocalMode(false);setError('')}}>Cores · opcional</button></div>{localMode ? <LeituraEscalaGratuita image={image} employees={activeEmployees} month={month} year={year} onResult={(result)=>{setRecords(result);setApproved(false);setError('')}} /> : image && <LeituraEscalaCores image={image} employees={activeEmployees} month={month} year={year} onResult={(result)=>{setRecords(result);setApproved(false);setError('')}} />}</div>
              <p className="rounded-xl bg-blue-50 p-4 text-sm leading-relaxed text-blue-900">
                A leitura é uma sugestão. Você confere nomes, dias e turnos
                antes de salvar. Células vazias e dúvidas ficam pendentes;
                nenhuma folga será inventada.
              </p>
              {reading && (
                <p
                  role="status"
                  className="flex items-center justify-center gap-2 text-sm text-slate-600"
                >
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Lendo todos os funcionários e dias…
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <details
                className="rounded-xl border border-slate-200 bg-white p-3"
                open
              >
                <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                  Comparar com a foto
                </summary>
                <div className="mt-3 max-h-64 overflow-auto">
                  <img
                    src={image}
                    alt="Imagem original para conferência dos nomes e turnos"
                    className="max-w-none min-w-full"
                    style={{ width: "100%" }}
                  />
                </div>
              </details>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-600">
                  <strong className="text-slate-900">
                    {employeeCount} funcionários
                  </strong>{" "}
                  · {validated.length} células ·{" "}
                  <span
                    className={
                      pending
                        ? "font-semibold text-amber-700"
                        : "text-emerald-700"
                    }
                  >
                    {pending} pendentes
                  </span>
                </p>
                <button
                  type="button"
                  className="action-secondary"
                  disabled={saving}
                  onClick={() => {
                    setRecords((old) => [
                      ...old,
                      {
                        id: crypto.randomUUID(),
                        rowIndex: old.length,
                        columnIndex: 0,
                        rawEmployeeText: "",
                        rawShiftText: "",
                        employeeId: null,
                        employeeName: "",
                        day: 0,
                        shiftId: null,
                        shiftName: "",
                        shiftSigla: "",
                        confidence: 1,
                        isCustomManual: true,
                      } as RegistroImportadoReconhecido,
                    ]);
                    setApproved(false);
                  }}
                >
                  <Plus className="h-4 w-4" />
                  Adicionar célula
                </button>
              </div>
              {<button type="button" disabled={saving} className="action-secondary w-full" onClick={()=>{setRecords(validated.map(r=>r.rawShiftText && r.employeeId && r.day>0 && r.shiftId ? {...r,conferidoManualmente:true}:r));setApproved(false)}}>Conferi todas as células reconhecidas com a escala original</button>}
              <div className="flex flex-wrap items-center gap-3">
                <input
                  aria-label="Buscar funcionário na leitura"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar funcionário…"
                  className="field-control max-w-xs"
                />
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={onlyPending}
                    onChange={(e) => setOnlyPending(e.target.checked)}
                  />
                  Somente pendentes
                </label>
              </div>
              <fieldset disabled={saving} className="min-w-0">
                <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <caption className="sr-only">
                      Conferência da leitura: funcionário, dia, turno, situação
                      e ações
                    </caption>
                    <thead className="bg-slate-100 text-xs uppercase text-slate-500">
                      <tr>
                        {[
                          "Funcionário",
                          "Dia",
                          "Turno / situação",
                          "Conferência",
                          "",
                        ].map((label, index) => (
                          <th key={index} scope="col" className="p-3">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visible.map((r) => (
                        <tr
                          key={r.id}
                          className={
                            r.status === "CONFIRMADO" ? "" : "bg-amber-50/60"
                          }
                        >
                          <td className="p-3">
                            <select
                              aria-label={`Funcionário da linha ${r.rowIndex + 1}`}
                              className="field-control"
                              value={r.employeeId || ""}
                              onChange={(e) =>
                                update(r.id, {
                                  employeeId: e.target.value || null,
                                  employeeName:
                                    activeEmployees.find(
                                      (f) => f.id === e.target.value,
                                    )?.nome || "",
                                  conferidoManualmente: false,
                                })
                              }
                            >
                              <option value="">Selecione o nome</option>
                              {activeEmployees.map((f) => (
                                <option key={f.id} value={f.id}>
                                  {f.nome}
                                </option>
                              ))}
                            </select>
                            <p className="mt-1 text-xs text-slate-500">
                              Na foto: {r.rawEmployeeText || "ilegível"}
                            </p>
                          </td>
                          <td className="p-3">
                            <select
                              aria-label={`Dia de ${r.employeeName}`}
                              className="field-control"
                              value={r.day}
                              onChange={(e) =>
                                update(r.id, {
                                  day: Number(e.target.value),
                                  conferidoManualmente: false,
                                })
                              }
                            >
                              <option value={0}>Dia?</option>
                              {Array.from({ length: days }, (_, i) => (
                                <option key={i + 1} value={i + 1}>
                                  {String(i + 1).padStart(2, "0")}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="p-3">
                            <select
                              aria-label={`Turno de ${r.employeeName} no dia ${r.day}`}
                              className="field-control"
                              value={r.shiftId || ""}
                              onChange={(e) =>
                                update(r.id, {
                                  shiftId: e.target.value || null,
                                  isFolga: e.target.value === "FOLGA",
                                  shiftName: "",
                                  conferidoManualmente: false,
                                })
                              }
                            >
                              <option value="">Selecione o turno</option>
                              {SHIFT_OPTIONS.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.sigla} · {t.inicio}–{t.fim}
                                </option>
                              ))}
                              {STATUS_OPTIONS.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.label}
                                </option>
                              ))}
                            </select>
                            <p className="mt-1 text-xs text-slate-500">
                              Na foto: {r.rawShiftText || "vazio / ilegível"}
                            </p>
                          </td>
                          <td className="max-w-64 p-3">
                            {r.status === "CONFIRMADO" ? (
                              <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700">
                                <Check className="h-4 w-4" />
                                Pronto
                              </span>
                            ) : (
                              <>
                                <p className="text-xs leading-relaxed text-amber-800">
                                  {r.observation}
                                </p>
                                {r.employeeId && r.shiftId && r.day > 0 && (
                                  <button
                                    type="button"
                                    className="mt-2 text-xs font-semibold text-blue-700 underline"
                                    onClick={() =>
                                      update(r.id, {
                                        conferidoManualmente: true,
                                      })
                                    }
                                  >
                                    Conferi esta célula na foto
                                  </button>
                                )}
                              </>
                            )}
                          </td>
                          <td className="p-2">
                            <button
                              type="button"
                              aria-label={`Remover célula de ${r.employeeName}, dia ${r.day}`}
                              className="rounded-lg p-3 text-slate-400 hover:bg-red-50 hover:text-red-600"
                              onClick={() => {
                                setRecords((old) =>
                                  old.filter((item) => item.id !== r.id),
                                );
                                setApproved(false);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {!visible.length && (
                        <tr>
                          <td
                            colSpan={5}
                            className="p-8 text-center text-slate-500"
                          >
                            Nenhuma célula neste filtro.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </fieldset>
              {pending > 0 && (
                <p className="flex items-start gap-2 text-sm text-amber-800">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Corrija as pendências ou remova as células que não devem ser
                  importadas. Nenhum registro será salvo enquanto houver
                  dúvidas.
                </p>
              )}
              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={approved}
                  disabled={pending > 0 || saving}
                  onChange={(e) => setApproved(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  Conferi todos os funcionários, dias e turnos. Autorizo
                  atualizar as células correspondentes no Planner de{" "}
                  {String(month).padStart(2, "0")}/{year}. Os demais registros
                  serão preservados.
                </span>
              </label>
            </div>
          )}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white p-4 sm:px-6">
          <button
            type="button"
            disabled={saving || reading}
            onClick={() => {
              if (records.length) {
                setRecords([]);
                setApproved(false);
              } else onClose();
            }}
            className="action-secondary"
          >
            {records.length ? "Voltar à foto" : "Cancelar"}
          </button>
          {records.length ? (
            <button
              type="button"
              disabled={saving || pending > 0 || !approved || !postoId}
              onClick={save}
              className="action-primary"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving
                ? "Salvando…"
                : `Confirmar ${validated.length} células no Planner`}
            </button>
          ) : (
            <p className="text-sm text-slate-500">Gere a prévia gratuita acima para continuar.</p>
          )}
        </footer>
      </div>
    </div>
  );
};