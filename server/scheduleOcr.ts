import { GoogleGenAI } from "@google/genai";

export class ScheduleOcrError extends Error {
  constructor(
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}

export function validateImagePayload(body: any) {
  const reference = String(body?.mesAnoReferencia || "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(reference)) {
    throw new ScheduleOcrError(
      "Selecione o mês e o ano da escala antes de enviar a imagem.",
      400,
    );
  }
  const raw = String(body?.imageBase64 || body?.image || "").trim();
  const match = raw.match(/^data:(image\/(?:jpeg|png|webp));base64,([\s\S]+)$/);
  const mimeType = match?.[1] || body?.mimeType || "image/jpeg";
  const base64 = (match?.[2] || raw).replace(/\s/g, "");
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(mimeType) ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) ||
    base64.length % 4 !== 0 ||
    base64.length < 64
  ) {
    throw new ScheduleOcrError(
      "Imagem inválida. Envie uma foto JPG, PNG ou WebP.",
      400,
    );
  }
  if (base64.length > 4_000_000) {
    throw new ScheduleOcrError(
      "A imagem está muito grande. Recorte a escala ou envie uma foto menor.",
      413,
    );
  }
  return { reference, mimeType, base64 };
}

export function buildSchedulePrompt(reference: string) {
  return `Leia a imagem como uma tabela de escala. O mês selecionado pelo usuário é ${reference}.
Extraia TODAS as linhas de funcionários, inclusive auxiliares e administrativos, e TODOS os dias visíveis até a última coluna.
Não complete o mês por padrão, não deduza folgas, não projete semanas, não aplique 5x2 ou 12x36.
Copie literalmente nomes e códigos. Célula vazia ou ilegível: rawText="", confidence=0. Não interprete vazio como folga.
Use o número do dia escrito no cabeçalho, nunca a posição da coluna. Se não houver dia legível, day=null.
Se houver vários blocos da tabela, leia todos. Se houver nomes repetidos, preserve as linhas para conferência.
O mês e ano de document devem ser os visíveis no documento; use null se não estiverem visíveis. Não substitua pelo mês selecionado.
Confiança de 0 a 1 deve refletir a legibilidade, não sua certeza sobre um padrão de escala.
Retorne somente JSON neste formato, sem markdown:
{"document":{"month":null,"year":null,"title":"texto visível"},"grid":{"headers":["Funcionário","01","02"],"rows":[{"rowIndex":0,"employeeCell":{"rawText":"nome lido","confidence":0.9},"dayCells":[{"day":1,"columnIndex":1,"rawText":"T1","confidence":0.9}]}]}}
O exemplo mostra apenas o formato. Não limite a extração aos dias ou funcionários do exemplo. Inclua cada célula de cada linha visível.`;
}

export function parseScheduleResponse(content: string, truncated = false) {
  if (truncated)
    throw new ScheduleOcrError(
      "A leitura ficou incompleta. Recorte a imagem em partes e tente novamente.",
    );
  let parsed: any;
  try {
    parsed = JSON.parse(
      content
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, ""),
    );
  } catch {
    throw new ScheduleOcrError(
      "A IA retornou uma leitura incompleta. Nenhum dado foi importado. Tente uma foto mais nítida.",
    );
  }
  const rows = parsed?.grid?.rows;
  if (
    !Array.isArray(rows) ||
    rows.length === 0 ||
    rows.length > 100 ||
    !rows.every(
      (row: any) =>
        typeof row?.employeeCell?.rawText === "string" &&
        Array.isArray(row?.dayCells) &&
        row.dayCells.length <= 62,
    ) ||
    !rows.some(
      (row: any) => row.employeeCell.rawText.trim() && row.dayCells.length,
    )
  ) {
    throw new ScheduleOcrError(
      "Não foi possível reconhecer uma tabela com funcionários e dias. Envie a escala completa e legível.",
    );
  }
  return parsed;
}

// One server-only implementation shared by local Express and Vercel.
export async function analyzeSchedule(body: any) {
  const { reference, mimeType, base64 } = validateImagePayload(body);
  const prompt = buildSchedulePrompt(reference);
  const geminiKey = process.env.GEMINI_API_KEY;
  const routerKey = process.env.OPENROUTER_API_KEY;
  let parsed: any;
  let engine: string;
  if (geminiKey) {
    const model = process.env.SCHEDULE_GEMINI_MODEL || "gemini-flash-latest";
    const ai = new GoogleGenAI({
      apiKey: geminiKey,
      httpOptions: { timeout: 55_000 },
    });
    const result = await ai.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }, { inlineData: { data: base64, mimeType } }],
        },
      ],
      config: {
        responseMimeType: "application/json",
        temperature: 0,
        maxOutputTokens: 32768,
      },
    });
    parsed = parseScheduleResponse(
      result.text || "",
      result.candidates?.[0]?.finishReason === "MAX_TOKENS",
    );
    engine = `Gemini (${model})`;
  } else if (routerKey) {
    // Explicit model configuration avoids silently selecting an obsolete or text-only model.
    const model =
      process.env.SCHEDULE_OPENROUTER_MODEL || process.env.OPENROUTER_MODEL;
    if (!model)
      throw new ScheduleOcrError(
        "Configure SCHEDULE_OPENROUTER_MODEL com um modelo que aceite imagens, ou configure GEMINI_API_KEY.",
        503,
      );
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${routerKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 32768,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                {
                  type: "image_url",
                  image_url: { url: `data:${mimeType};base64,${base64}` },
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(55_000),
      },
    );
    if (!response.ok)
      throw new ScheduleOcrError(
        response.status === 429
          ? "O serviço de leitura atingiu o limite temporário. Tente novamente mais tarde."
          : "O serviço de leitura recusou a solicitação. Verifique a chave e se o modelo configurado aceita imagens.",
        response.status === 429 ? 429 : 502,
      );
    const result: any = await response.json();
    parsed = parseScheduleResponse(
      result?.choices?.[0]?.message?.content || "",
      result?.choices?.[0]?.finish_reason === "length",
    );
    engine = `OpenRouter (${model})`;
  } else {
    throw new ScheduleOcrError(
      "A leitura por imagem ainda não está configurada. Configure GEMINI_API_KEY no servidor ou OPENROUTER_API_KEY e SCHEDULE_OPENROUTER_MODEL. Você pode editar a escala manualmente no Planner.",
      503,
    );
  }
  return { success: true, data: parsed, motorUtilizado: engine };
}

export default async function scheduleOcrHandler(req: any, res: any) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST")
    return res
      .status(405)
      .json({ success: false, error: "Use POST para enviar a escala." });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    return res.status(200).json(await analyzeSchedule(body));
  } catch (error: any) {
    const status =
      error instanceof ScheduleOcrError
        ? error.status
        : error instanceof SyntaxError
          ? 400
          : 502;
    return res
      .status(status)
      .json({
        success: false,
        error:
          error instanceof ScheduleOcrError
            ? error.message
            : status === 400
              ? "O envio da imagem é inválido."
              : "Não foi possível concluir a leitura. Verifique a conexão e a configuração do serviço de IA.",
      });
  }
}
