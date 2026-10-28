import assert from "node:assert/strict";
import { test } from "node:test";
import type { Funcionario, Escala } from "../src/types";
import {
  processarLeituraBrutaParaValidacao as parse,
  resolveDay,
  validateRecord,
  revalidarRegistrosEscala,
  TURNOS_PADRAO_POSTO as shifts,
} from "../src/features/planner/importadorEscalaImagemService";
import { prepararImportacaoEscala } from "../src/features/planner/prepararImportacaoEscala";
import { ScheduleImageImporter } from "../src/services/ai/scheduleImageImporter";
import handler, {
  analyzeSchedule,
  parseScheduleResponse,
  validateImagePayload,
} from "../server/scheduleOcr";

const employees = [
  "Ana Silva",
  "Bruno Santos",
  "Carlos Lima",
  "Dora Reis",
  "Auxiliar Um",
  "Auxiliar Dois",
  "Auxiliar Três",
].map(
  (nome, i) =>
    ({
      id: `f${i}`,
      nome,
      status: "ATIVO",
      cargo: i > 3 ? "Auxiliar" : "Frentista",
    }) as Funcionario,
);
const grid = (cells: any[], name = employees[0].nome, confidence = 1) => ({
  grid: {
    headers: ["Funcionário", "15", "16"],
    rows: [
      {
        rowIndex: 0,
        employeeCell: { rawText: name, confidence },
        dayCells: cells,
      },
    ],
  },
});
const cell = (day: any, rawText = "T1", confidence = 1) => ({
  day,
  columnIndex: 1,
  rawText,
  confidence,
});
const read = (raw: any, month = 10, year = 2026) =>
  parse(raw, employees, shifts, month, year);
const good = () => read(grid([cell(15)])).records[0];
const image = `data:image/png;base64,${Buffer.alloc(80).toString("base64")}`;
const payload = { imageBase64: image, mesAnoReferencia: "2026-10" };

test("all 31 days and all seven employees, including three auxiliaries, survive validation", () => {
  const raw = {
    grid: {
      rows: employees.map((e, index) => ({
        rowIndex: index,
        employeeCell: { rawText: e.nome, confidence: 1 },
        dayCells: Array.from({ length: 31 }, (_, i) =>
          cell(i + 1, i % 3 === 0 ? "T2" : "T1"),
        ),
      })),
    },
  };
  const result = read(raw);
  assert.equal(result.records.length, 217);
  assert.equal(result.totalConfirmados, 217);
  for (const employee of employees)
    assert.equal(
      result.records.filter((r) => r.employeeId === employee.id && r.day === 31)
        .length,
      1,
    );
});
test("explicit day takes precedence over column position", () =>
  assert.equal(read(grid([cell(25)])).records[0].day, 25));
test("header maps an unknown day without shifting the first visible date to day one", () =>
  assert.equal(read(grid([cell(null)])).records[0].day, 15));
test("invalid explicit day is blocked rather than clamped", () => {
  const r = read(grid([cell(31)]), 2).records[0];
  assert.equal(r.day, 0);
  assert.equal(r.status, "REVISAO");
});
test("non-numeric and fractional dates remain pending", () => {
  assert.equal(resolveDay("SEG", 3, [], 31).valid, false);
  assert.equal(resolveDay(1.5, 3, [], 31).valid, false);
});
test("T2 keeps its own hours rather than matching the end time of T1", () => {
  const r = read(grid([cell(1, "14-22")])).records[0];
  assert.equal(r.shiftSigla, "T2");
  assert.equal(r.horarioInicio, "14:00");
  assert.equal(r.horarioFim, "22:00");
});
test("empty cells do not become work or folga", () => {
  const r = read(grid([cell(1, "")])).records[0];
  assert.equal(r.shiftId, null);
  assert.notEqual(r.status, "CONFIRMADO");
});
test("zero confidence is never replaced with a high default", () => {
  const r = read(grid([cell(1, "T1", 0)])).records[0];
  assert.equal(r.confidence, 0);
  assert.equal(r.status, "REVISAO");
});
test("low name confidence requires review even when the shift is clear", () =>
  assert.equal(
    read(grid([cell(1)], employees[0].nome, 0.2)).records[0].status,
    "REVISAO",
  ));
test("explicit manual confirmation clears confidence doubt, but cannot clear an invalid day", () => {
  const r = read(grid([cell(1, "T1", 0.3)])).records[0];
  assert.equal(
    validateRecord({ ...r, conferidoManualmente: true }, employees, shifts, 31)
      .status,
    "CONFIRMADO",
  );
  assert.equal(
    validateRecord(
      { ...r, day: 0, conferidoManualmente: true },
      employees,
      shifts,
      31,
    ).status,
    "REVISAO",
  );
});
test("duplicate employee/day blocks both cells and clears after removing the extra cell", () => {
  const records = read(grid([cell(1), cell(1, "T2")])).records;
  assert.ok(records.every((r) => r.status === "REVISAO"));
  assert.equal(
    revalidarRegistrosEscala(records.slice(0, 1), employees, shifts, 31)[0]
      .status,
    "CONFIRMADO",
  );
});
test("unknown employee is not invented", () =>
  assert.equal(
    read(grid([cell(1)], "Nome inexistente")).records[0].employeeId,
    null,
  ));
test("ambiguous employee name is not automatically selected", () => {
  const result = parse(
    grid([cell(1)], "Ana"),
    [...employees, { ...employees[0], id: "ana2", nome: "Ana Lima" }],
    shifts,
    10,
    2026,
  );
  assert.equal(result.records[0].employeeId, null);
});
test("flat cells use DAY_NUMBER headers, ignore header rows and retain name confidence", () => {
  const result = read({
    cells: [
      { rowIndex: 0, columnIndex: 0, role: "HEADER", rawText: "Nome" },
      { rowIndex: 0, columnIndex: 2, role: "DAY_NUMBER", rawText: "27" },
      {
        rowIndex: 1,
        columnIndex: 0,
        role: "EMPLOYEE",
        rawText: "Ana Silva",
        confidence: 1,
      },
      {
        rowIndex: 1,
        columnIndex: 2,
        role: "SHIFT_VALUE",
        rawText: "T2",
        confidence: 1,
      },
    ],
  });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].day, 27);
});
test("empty cells array does not hide a legacy collaborator list", () => {
  const result = read({
    cells: [],
    colaboradoresEscala: [
      {
        nomeOriginal: "Ana Silva",
        confidence: 1,
        dias: [{ dia: 8, codigoOriginal: "T2", confidence: 1 }],
      },
    ],
  });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].day, 8);
});
test("an employee with no visible dates never generates a month or a weekly folga pattern", () => {
  const result = read({
    colaboradoresEscala: [{ nomeOriginal: "Ana Silva", turnoPadrao: "T1" }],
  });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].day, 0);
  assert.equal(result.totalConfirmados, 0);
});
test("import plan reuses an existing ID and preserves untouched dates", () => {
  const old = {
    id: "existing-legacy-id",
    funcionarioId: "f0",
    data: "2026-10-15",
    criadoEm: "original-date",
    intervalo: "1h",
  } as Escala;
  const untouched = {
    id: "untouched",
    funcionarioId: "f0",
    data: "2026-10-16",
  } as Escala;
  const plan = prepararImportacaoEscala(
    [good()],
    employees,
    [old, untouched],
    "posto-test",
    "2026-10",
    undefined,
    { funcionarioIds: ["f0"], primeiroDia: 15, ultimoDia: 15 },
  );
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].id, old.id);
  assert.equal(plan.updates[0].criadoEm, "original-date");
  assert.equal(plan.updates[0].intervalo, "1h");
  assert.deepEqual(plan.replaced, [old]);
});
test("import plan refuses review cells and duplicates without producing writes", () => {
  assert.throws(() =>
    prepararImportacaoEscala(
      [{ ...good(), status: "REVISAO" }],
      employees,
      [],
      "posto",
      "2026-10",
    ),
  );
  assert.throws(() =>
    prepararImportacaoEscala(
      [good(), good()],
      employees,
      [],
      "posto",
      "2026-10",
    ),
  );
  assert.throws(() =>
    prepararImportacaoEscala(
      [good()],
      employees,
      [
        { id: "a", funcionarioId: "f0", data: "2026-10-15" },
        { id: "b", funcionarioId: "f0", data: "2026-10-15" },
      ] as Escala[],
      "posto",
      "2026-10",
    ),
  );
});
test("model period mismatch blocks the import before changing the Planner", async () => {
  const importer = new ScheduleImageImporter({
    async analyzeScheduleImage() {
      return {
        success: true,
        data: { ...grid([cell(1)]), document: { month: 9, year: 2026 } },
        cells: [],
        motorUtilizado: "test",
      };
    },
  });
  await assert.rejects(
    () => importer.processImage(image, employees, shifts, 10, 2026),
    /diferente/,
  );
});
test("malformed model JSON is rejected instead of repaired into partial data", () => {
  assert.throws(() => parseScheduleResponse('{"grid":{"rows":['));
  assert.throws(() =>
    parseScheduleResponse(JSON.stringify(grid([cell(1)])), true),
  );
  assert.throws(() => parseScheduleResponse('{"grid":{"rows":[]}}'));
});
test("invalid images, oversized requests and invalid periods are rejected", () => {
  assert.throws(() =>
    validateImagePayload({ ...payload, mesAnoReferencia: "2026-13" }),
  );
  assert.throws(() =>
    validateImagePayload({
      ...payload,
      imageBase64: "https://example.com/photo.png",
    }),
  );
  assert.throws(() =>
    validateImagePayload({ ...payload, imageBase64: "A".repeat(4_000_004) }),
  );
  assert.equal(validateImagePayload(payload).mimeType, "image/png");
});
test("missing credentials returns an honest 503, never success with empty cells", async () => {
  const before = {
    gemini: process.env.GEMINI_API_KEY,
    router: process.env.OPENROUTER_API_KEY,
  };
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    await assert.rejects(
      () => analyzeSchedule(payload),
      (err: any) => err.status === 503,
    );
    let status = 0,
      body: any;
    const response: any = {
      setHeader() {},
      status(code: number) {
        status = code;
        return this;
      },
      json(value: any) {
        body = value;
        return this;
      },
    };
    await handler({ method: "POST", body: payload }, response);
    assert.equal(status, 503);
    assert.equal(body.success, false);
  } finally {
    for (const [key, value] of [
      ["GEMINI_API_KEY", before.gemini],
      ["OPENROUTER_API_KEY", before.router],
    ]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
  }
});
test("server sends an actual image to the configured vision provider and returns the exact grid", async () => {
  const previous = {
    gemini: process.env.GEMINI_API_KEY,
    router: process.env.OPENROUTER_API_KEY,
    model: process.env.SCHEDULE_OPENROUTER_MODEL,
    fetch: globalThis.fetch,
  };
  delete process.env.GEMINI_API_KEY;
  process.env.OPENROUTER_API_KEY = "fake-test-only";
  process.env.SCHEDULE_OPENROUTER_MODEL = "test/vision";
  const expected = grid([cell(31, "T2")]);
  globalThis.fetch = async (_url, init) => {
    const sent = JSON.parse(String(init?.body));
    assert.equal(sent.model, "test/vision");
    assert.equal(sent.messages[0].content[1].image_url.url, image);
    assert.ok(sent.messages[0].content[0].text.includes("12x36"));
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: { content: JSON.stringify(expected) },
            finish_reason: "stop",
          },
        ],
      }),
      { status: 200 },
    );
  };
  try {
    assert.deepEqual((await analyzeSchedule(payload)).data, expected);
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of [
      ["GEMINI_API_KEY", previous.gemini],
      ["OPENROUTER_API_KEY", previous.router],
      ["SCHEDULE_OPENROUTER_MODEL", previous.model],
    ]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
  }
});

test("Gemini SDK receives inline image data and its JSON result is validated", async () => {
  const previous = { key: process.env.GEMINI_API_KEY, fetch: globalThis.fetch };
  process.env.GEMINI_API_KEY = "fake-test-only";
  const expected = grid([cell(30, "S")]);
  globalThis.fetch = async (url, init) => {
    assert.ok(String(url).includes("generateContent"));
    const sent = JSON.parse(String(init?.body));
    assert.equal(sent.contents[0].parts[1].inlineData.mimeType, "image/png");
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: JSON.stringify(expected) }],
            },
            finishReason: "STOP",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  try {
    assert.deepEqual((await analyzeSchedule(payload)).data, expected);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.key === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous.key;
  }
});

test('an employee row without day cells remains visible as a pending record', () => {
  const result = read(grid([]));
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].employeeId, 'f0');
  assert.equal(result.records[0].day, 0);
  assert.notEqual(result.records[0].status, 'CONFIRMADO');
});
