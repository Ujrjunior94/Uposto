import { AIProvider } from "./aiProvider";
import {
  processarLeituraBrutaParaValidacao,
  ResultadoImportacaoEscala,
  TurnoCadastrado,
  TURNOS_PADRAO_POSTO,
} from "../../features/planner/importadorEscalaImagemService";
import { Funcionario } from "../../types";
import { comprimirImagemClienteParaOCR } from "../geminiOcrService";

export interface ScheduleProcessOptions {
  mimeType?: string;
  motor?: "deepseek" | "openrouter" | "gemini"; // legacy callers; provider selection is server-side
  provider?: AIProvider;
  signal?: AbortSignal;
}

export class ScheduleImageImporter {
  constructor(private provider?: AIProvider) {}

  async processImage(
    imageBase64: string,
    employees: Funcionario[],
    shifts: TurnoCadastrado[] = TURNOS_PADRAO_POSTO,
    month: number,
    year: number,
    options?: ScheduleProcessOptions,
  ): Promise<ResultadoImportacaoEscala> {
    const reference = `${year}-${String(month).padStart(2, "0")}`;
    let result: any;
    const provider = options?.provider || this.provider;
    if (provider) {
      result = await provider.analyzeScheduleImage(imageBase64, {
        mimeType: options?.mimeType,
        mesAnoReferencia: reference,
        signal: options?.signal,
      });
    } else {
      const image = await comprimirImagemClienteParaOCR(imageBase64, 2800);
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (options?.signal?.aborted) controller.abort();
      options?.signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, 60_000);
      try {
        const response = await fetch("/api/analyze-schedule-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            imageBase64: image.dataUrl,
            mimeType: image.mimeType,
            mesAnoReferencia: reference,
          }),
        });
        result = await response.json().catch(() => null);
        if (!response.ok)
          throw new Error(
            result?.error ||
              "O serviço de leitura não respondeu. Tente novamente.",
          );
      } catch (error: any) {
        if (error?.name === "AbortError")
          throw new Error(
            "A leitura foi cancelada ou excedeu o tempo limite. Tente uma foto menor.",
          );
        throw error;
      } finally {
        clearTimeout(timer);
        options?.signal?.removeEventListener("abort", abort);
      }
    }
    if (!result?.success)
      throw new Error(result?.error || "Não foi possível ler a imagem.");
    const raw = result.data || result;
    if (
      (raw.document?.month != null && Number(raw.document.month) !== month) ||
      (raw.document?.year != null && Number(raw.document.year) !== year)
    ) {
      throw new Error(
        "O mês ou ano lido na imagem é diferente do mês selecionado. Confira a foto e selecione o período correto antes de importar.",
      );
    }
    const validated = processarLeituraBrutaParaValidacao(
      raw,
      employees,
      shifts,
      month,
      year,
    );
    if (!validated.records.length)
      throw new Error(
        "Nenhum dia foi reconhecido. Envie uma imagem completa e legível da escala.",
      );
    validated.motorUtilizado = result.motorUtilizado || "Leitura por imagem";
    return validated;
  }
}

export const scheduleImageImporter = new ScheduleImageImporter();
