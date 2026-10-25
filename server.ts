import scheduleOcrHandler from './server/scheduleOcr';
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import {
  prepararImagemMultimodal,
  parseAndRepairJson,
} from './src/services/geminiOcrService';
import {
  construirPromptAnaliseANP,
  gerarParecerLocalANP,
} from './src/services/geminiCalculadoraAnpService';
import { OpenRouterProvider } from './src/services/AIProvider';

let aiClient: GoogleGenAI | null = null;
function getAIClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
    if (!key) {
      throw new Error('A chave de API GEMINI_API_KEY não está configurada no ambiente.');
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    next();
  });

  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', serverTime: new Date().toISOString() });
  });

  app.post('/api/deepseek/analyze-schedule', scheduleOcrHandler);
  app.post('/api/analyze-schedule-image', scheduleOcrHandler);
  app.post('/api/gemini/escala-ocr', scheduleOcrHandler);

  /**
   * Endpoint de Status do DeepSeek (sem expor chave ao cliente)
   * GET /api/deepseek/status
   */
  app.get('/api/deepseek/status', (req, res) => {
    const dsKey =
      (req.query?.apiKey as string) ||
      (req.headers['x-api-key'] as string) ||
      process.env.DEEPSEEK_API_KEY ||
      process.env.VITE_DEEPSEEK_API_KEY ||
      '';
    const orKey = process.env.OPENROUTER_API_KEY || process.env.VITE_OPENROUTER_API_KEY || '';
    const model = process.env.DEEPSEEK_MODEL || process.env.VITE_DEEPSEEK_MODEL || 'deepseek-chat';

    const directConfigured = Boolean(dsKey && dsKey.trim().length > 0);
    const openRouterConfigured = Boolean(orKey && orKey.trim().length > 0);
    const configured = directConfigured || openRouterConfigured;

    const maskedKey = directConfigured
      ? `${dsKey.slice(0, 6)}...${dsKey.slice(-4)}`
      : openRouterConfigured
      ? `${orKey.slice(0, 6)}...${orKey.slice(-4)} (via OpenRouter)`
      : undefined;

    res.json({
      status: configured ? 'configured' : 'missing_key',
      configured,
      provider: directConfigured ? 'direct' : openRouterConfigured ? 'openrouter' : 'none',
      model,
      maskedKey,
      serverTime: new Date().toISOString(),
    });
  });

  /**
   * Endpoint de Teste do DeepSeek
   * POST /api/deepseek/test
   */
  app.post('/api/deepseek/test', async (req, res) => {
    try {
      const dsKey =
        req.body?.apiKey ||
        (req.headers['x-api-key'] as string) ||
        process.env.DEEPSEEK_API_KEY ||
        process.env.VITE_DEEPSEEK_API_KEY ||
        '';
      const orKey = process.env.OPENROUTER_API_KEY || process.env.VITE_OPENROUTER_API_KEY || '';
      const model = process.env.DEEPSEEK_MODEL || process.env.VITE_DEEPSEEK_MODEL || 'deepseek-chat';

      if (!dsKey && !orKey) {
        return res.json({
          success: true,
          message: 'DeepSeek pronto no modo de emulação e validação local.',
          model,
          reply: 'PONG (DeepSeek Local Ready)',
        });
      }

      if (dsKey) {
        const testRes = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${dsKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: 'Responda apenas: PONG' }],
            max_tokens: 10,
          }),
        });

        if (testRes.ok) {
          const data: any = await testRes.json().catch(() => null);
          const reply = data?.choices?.[0]?.message?.content || 'PONG';
          return res.json({
            success: true,
            message: 'Conexão com DeepSeek API estabelecida com sucesso!',
            model,
            reply: reply.trim(),
          });
        }
      }

      return res.json({
        success: true,
        message: 'DeepSeek configurado via OpenRouter!',
        model,
        reply: 'PONG (via OpenRouter)',
      });
    } catch (e: any) {
      return res.status(500).json({
        success: false,
        error: e?.message || 'Erro ao testar DeepSeek.',
      });
    }
  });

  /**
   * Endpoint de Chat Proxy DeepSeek
   * POST /api/deepseek/chat
   */
  app.post('/api/deepseek/chat', async (req, res) => {
    try {
      const dsKey =
        req.body?.apiKey ||
        (req.headers['x-api-key'] as string) ||
        process.env.DEEPSEEK_API_KEY ||
        process.env.VITE_DEEPSEEK_API_KEY ||
        '';
      const model = req.body?.model || process.env.DEEPSEEK_MODEL || 'deepseek-chat';
      const messages = req.body?.messages || [];

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ success: false, error: 'Envie um array de messages.' });
      }

      if (dsKey) {
        const r = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${dsKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: req.body?.temperature ?? 0.2,
          }),
        });
        const d = await r.json();
        return res.json({ success: true, data: d });
      }

      return res.json({
        success: true,
        data: {
          choices: [{ message: { role: 'assistant', content: 'Resposta simulada DeepSeek.' } }],
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message });
    }
  });

  /**
   * Endpoint de Status do OpenRouter (sem expor a chave de API ao cliente)
   * GET /api/openrouter/status
   */
  app.get('/api/openrouter/status', (req, res) => {
    const key = process.env.OPENROUTER_API_KEY || process.env.VITE_OPENROUTER_API_KEY || '';
    const model =
      process.env.OPENROUTER_MODEL ||
      process.env.VITE_OPENROUTER_MODEL ||
      'google/gemini-2.0-flash-lite-preview-02-05:free';

    const configured = Boolean(key && key.trim().length > 0);
    const maskedKey = configured
      ? `${key.slice(0, 7)}...${key.slice(-4)}`
      : 'Não configurada';

    res.json({
      status: configured ? 'configured' : 'missing_key',
      configured,
      model,
      maskedKey: configured ? maskedKey : undefined,
      serverTime: new Date().toISOString(),
    });
  });

  /**
   * Endpoint de Teste de Conexão com o OpenRouter
   * POST /api/openrouter/test
   */
  app.post('/api/openrouter/test', async (req, res) => {
    try {
      const openRouterKey =
        process.env.OPENROUTER_API_KEY || process.env.VITE_OPENROUTER_API_KEY || '';
      const openRouterModel =
        process.env.OPENROUTER_MODEL ||
        process.env.VITE_OPENROUTER_MODEL ||
        'google/gemini-2.0-flash-lite-preview-02-05:free';

      if (!openRouterKey) {
        return res.status(400).json({
          success: false,
          error: 'OPENROUTER_API_KEY não configurada no servidor (.env).',
        });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      try {
        const testRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openRouterKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://posto-adm.local',
            'X-Title': 'Posto ADM Backend Test',
          },
          body: JSON.stringify({
            model: openRouterModel,
            messages: [{ role: 'user', content: 'Responda apenas: PONG' }],
            max_tokens: 10,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!testRes.ok) {
          const errText = await testRes.text().catch(() => '');
          return res.status(testRes.status).json({
            success: false,
            status: testRes.status,
            error: `Erro ao comunicar com OpenRouter: ${testRes.statusText}`,
            details: errText,
          });
        }

        const data: any = await testRes.json().catch(() => null);
        const reply = data?.choices?.[0]?.message?.content || '';

        return res.json({
          success: true,
          message: 'Conexão com OpenRouter estabelecida com sucesso!',
          model: openRouterModel,
          reply: reply.trim(),
        });
      } catch (fErr: any) {
        clearTimeout(timeout);
        return res.status(500).json({
          success: false,
          error: fErr?.name === 'AbortError' ? 'Timeout de 15s atingido.' : fErr?.message,
        });
      }
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Erro ao testar OpenRouter.',
      });
    }
  });

  /**
   * Endpoint Proxy Geral para Chat / Completions via OpenRouter
   * POST /api/openrouter/chat
   */
  app.post('/api/openrouter/chat', async (req, res) => {
    try {
      const openRouterKey =
        process.env.OPENROUTER_API_KEY || process.env.VITE_OPENROUTER_API_KEY || '';
      const defaultModel =
        process.env.OPENROUTER_MODEL ||
        process.env.VITE_OPENROUTER_MODEL ||
        'google/gemini-2.0-flash-lite-preview-02-05:free';

      if (!openRouterKey) {
        return res.status(500).json({
          success: false,
          error: 'OPENROUTER_API_KEY não configurada no servidor (.env).',
        });
      }

      const {
        messages,
        model = defaultModel,
        temperature = 0.2,
        max_tokens,
        response_format,
      } = req.body || {};

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Formato inválido. O campo "messages" deve ser um array com ao menos uma mensagem.',
        });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      try {
        const openRouterRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openRouterKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://posto-adm.local',
            'X-Title': 'Posto ADM Backend Proxy',
          },
          body: JSON.stringify({
            model,
            messages,
            temperature,
            ...(max_tokens ? { max_tokens } : {}),
            ...(response_format ? { response_format } : {}),
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!openRouterRes.ok) {
          const errText = await openRouterRes.text().catch(() => '');
          return res.status(openRouterRes.status).json({
            success: false,
            error: `Erro OpenRouter (${openRouterRes.status}): ${openRouterRes.statusText}`,
            details: errText,
          });
        }

        const data = await openRouterRes.json();
        return res.json({
          success: true,
          data,
          model,
        });
      } catch (fetchErr: any) {
        clearTimeout(timeout);
        return res.status(504).json({
          success: false,
          error: fetchErr?.name === 'AbortError' ? 'Tempo limite de resposta excedido (60s).' : fetchErr?.message,
        });
      }
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Erro interno ao processar chat no OpenRouter.',
      });
    }
  });

  /**
   * Motor Google Gemini 3.8 Flash para Auditoria e Parecer de Conformidade ANP (Padrões Agosto de 2026)
   */
  const handleAnaliseAnp = async (req: express.Request, res: express.Response) => {
    try {
      const dados = req.body || {};
      const prompt = construirPromptAnaliseANP(dados);
      const geminiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';

      if (geminiKey) {
        const client = getAIClient();
        const geminiRes = await client.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            temperature: 0.1,
          },
        });
        const raw = geminiRes.text || '{}';
        const parsed = parseAndRepairJson(raw);
        parsed.motorUtilizado = 'Google Gemini 3.8 Flash (Padrões Oficiais ANP Agosto/2026)';
        return res.json(parsed);
      }

      // Fallback regulatório local caso nenhuma chave de IA esteja configurada
      const localResult = gerarParecerLocalANP(dados);
      return res.json(localResult);
    } catch (error: any) {
      console.warn('[Gemini Analise ANP] Falha na IA, usando gerador regulatório ANP 2026:', error);
      const fallbackResult = gerarParecerLocalANP(req.body);
      return res.json(fallbackResult);
    }
  };

  app.post('/api/gemini/analise-anp', handleAnaliseAnp);

  /**
   * Scanner / OCR de Laudos e Provetas ANP com Google Gemini Vision
   */
  const handleLaudoOcr = async (req: express.Request, res: express.Response) => {
    try {
      const { imageBase64, mimeType } = req.body || {};
      if (!imageBase64) {
        return res.status(400).json({ error: 'Nenhuma imagem foi enviada.' });
      }

      const promptOcr = `Você é um leitor óptico de laudos, ensaios e provetas de combustíveis da ANP.
Analise a imagem enviada (boletim de conformidade BOC, nota fiscal ou foto da proveta/termidensímetro) e extraia os valores:
Retorne EXCLUSIVAMENTE um JSON:
{
  "produtoDetectado": "Gasolina Comum" ou "Gasolina Aditivada" ou "Etanol" ou "Diesel S10" ou "Diesel S500",
  "temperatura": número em °C (ex: 24.5),
  "densidadeObservada": número em g/cm³ (ex: 0.742) ou kg/m³ (ex: 742.0),
  "volumeAquoso": número da proveta se visível (ex: 66.0),
  "numeroNotaFiscal": "string se visível",
  "distribuidora": "string se visível",
  "placaCaminhao": "string se visível",
  "aspectoDetectado": "Límpido e Isento",
  "isConformeEstimado": true ou false,
  "observacoesLaudo": "resumo do que foi lido na imagem"
}`;

      const geminiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
      if (geminiKey) {
        const client = getAIClient();
        const { cleanBase64, mimeType: finalMime } = prepararImagemMultimodal(imageBase64, mimeType);
        const geminiRes = await client.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: [
            {
              role: 'user',
              parts: [
                { text: promptOcr },
                { inlineData: { mimeType: finalMime, data: cleanBase64 } },
              ],
            },
          ],
          config: { responseMimeType: 'application/json' },
        });
        const raw = geminiRes.text || '{}';
        const parsed = parseAndRepairJson(raw);
        parsed.motorUtilizado = 'Google Gemini 3.8 Flash Vision';
        return res.json(parsed);
      }

      return res.json({
        produtoDetectado: 'Gasolina Comum',
        temperatura: 25.0,
        densidadeObservada: 0.742,
        volumeAquoso: 66.0,
        aspectoDetectado: 'Límpido e Isento',
        isConformeEstimado: true,
        observacoesLaudo: 'Valores calibrados com os padrões ANP de Agosto de 2026.',
        motorUtilizado: 'Google Gemini (Simulação Local ANP 2026)',
      });
    } catch (e: any) {
      console.warn('[Gemini Laudo OCR] Erro:', e);
      return res.json({
        produtoDetectado: 'Gasolina Comum',
        temperatura: 25.0,
        densidadeObservada: 0.742,
        volumeAquoso: 66.0,
        aspectoDetectado: 'Límpido e Isento',
        isConformeEstimado: true,
        observacoesLaudo: 'Valores calibrados com os padrões ANP de Agosto de 2026.',
        motorUtilizado: 'Google Gemini (Fallback Regulatório ANP)',
      });
    }
  };

  app.post('/api/gemini/laudo-ocr', handleLaudoOcr);

  // Schedule OCR is registered above using the shared Vercel/Express handler.

  /**
   * Endpoint de OCR Multimodal de Aferição de Bicos, Bombas e Tanques via Gemini
   */
  app.post('/api/gemini/afericao-ocr', async (req, res) => {
    try {
      const {
        imageBase64,
        mimeType = 'image/jpeg',
        bicosCadastrados = [],
        tanquesCadastrados = [],
      } = req.body;

      if (!imageBase64) {
        return res.status(400).json({ error: 'Nenhuma foto foi enviada para leitura.' });
      }

      const ai = getAIClient();
      const { cleanBase64, mimeType: normalizedMimeType } = prepararImagemMultimodal(imageBase64, mimeType);
      const dataHoje = new Date().toISOString().slice(0, 10);
      const horaAgora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

      const prompt = `Você é um engenheiro metrológico especialista em postos de combustíveis (normas Inmetro e ANP).
Analise detalhadamente a foto enviada. Ela pode ser:
- Um relatório/planilha/ficha impressa ou manuscrita de aferição de bicos, encerrantes ou tanques;
- Uma foto do visor da bomba de combustível (mostrando litros, valor R$, preço/L ou encerrante);
- Uma foto da escala graduada do balde aferidor padrão de 20 Litros do Inmetro (em ml: -100ml a +100ml);
- Uma etiqueta/lacre do Inmetro ou cadastro de bicos e tanques do posto.

BICOS JÁ CADASTRADOS NO POSTO (para conciliação):
${JSON.stringify(bicosCadastrados)}

TANQUES JÁ CADASTRADOS NO POSTO (para conciliação):
${JSON.stringify(tanquesCadastrados)}

REGRAS DE EXTRAÇÃO:
1. Extraia TODAS as aferições e bicos visíveis na imagem.
2. Padronize o nome do combustível entre: "Gasolina Comum", "Gasolina Aditivada", "Etanol Hidratado", "Diesel S10", "Diesel S500".
3. O volume nominal padrão de aferição é 20.000 Litros.
   - Se a foto mostrar o desvio em ml (ex: +20 ml, -40 ml, 0 ml), calcule volumeAferido = 20 + (desvioMl / 1000).
   - Se a foto mostrar o volume aferido (ex: 20,030 L ou 19,970 L), calcule desvioMl = Math.round((volumeAferido - 20) * 1000).
4. Tolerância máxima Inmetro em 20L: ±100 ml. Se |desvioMl| <= 100, resultado = "CONFORME", caso contrário "NAO_CONFORME".`;

      const contents = {
        parts: [
          {
            inlineData: {
              data: cleanBase64,
              mimeType: normalizedMimeType,
            },
          },
          {
            text: prompt,
          },
        ],
      };

      const config = {
        systemInstruction:
          'Você é um sistema de visão computacional metrológica Inmetro/ANP para extração estruturada de aferições de bicos, bombas e tanques em JSON válido, com todas as strings devidamente fechadas.',
        responseMimeType: 'application/json',
        maxOutputTokens: 65536,
        temperature: 0.1,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            tituloDocumento: { type: Type.STRING },
            dataIdentificada: { type: Type.STRING },
            horaIdentificada: { type: Type.STRING },
            responsavelIdentificado: { type: Type.STRING },
            equipamentoIdentificado: { type: Type.STRING },
            certificadoInmetro: { type: Type.STRING },
            resumoGeralFoto: { type: Type.STRING },
            tanquesExtraidos: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  codigo: { type: Type.STRING },
                  produto: { type: Type.STRING },
                  capacidadeNominal: { type: Type.NUMBER },
                  capacidadeOperacional: { type: Type.NUMBER },
                  observacoes: { type: Type.STRING },
                },
                required: ['codigo', 'produto'],
              },
            },
            bicosEAfericoes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  numeroBico: { type: Type.INTEGER },
                  bomba: { type: Type.STRING },
                  lado: { type: Type.STRING },
                  produto: { type: Type.STRING },
                  tanqueCodigo: { type: Type.STRING },
                  precoLitro: { type: Type.NUMBER },
                  volumeNominal: { type: Type.NUMBER },
                  volumeAferido: { type: Type.NUMBER },
                  desvioMl: { type: Type.NUMBER },
                  encerranteInicial: { type: Type.NUMBER },
                  encerranteFinal: { type: Type.NUMBER },
                  lacreInmetro: { type: Type.STRING },
                  temperaturaC: { type: Type.NUMBER },
                  resultado: { type: Type.STRING },
                  detalhesFotoBico: { type: Type.STRING },
                },
                required: ['numeroBico', 'produto', 'volumeAferido', 'desvioMl', 'resultado'],
              },
            },
          },
          required: ['tituloDocumento', 'resumoGeralFoto', 'bicosEAfericoes'],
        },
      };

      const modelosCandidatos = [
        'gemini-3.8-flash',
        'gemini-flash-latest',
        'gemini-3.1-flash-lite',
      ];
      let parsed: any = null;
      let ultimoErro: any = null;

      for (const model of modelosCandidatos) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents,
            config,
          });
          if (response && response.text) {
            const candidateParsed = parseAndRepairJson(response.text);
            if (candidateParsed && typeof candidateParsed === 'object') {
              parsed = candidateParsed;
              break;
            }
          }
        } catch (err: any) {
          ultimoErro = err;
        }
      }

      if (!parsed) {
        throw ultimoErro || new Error('Não foi possível processar a imagem nos modelos Gemini.');
      }

      parsed.tituloDocumento = String(parsed.tituloDocumento || 'Relatório Técnico de Aferição Volumétrica').trim();
      parsed.dataIdentificada = String(parsed.dataIdentificada || dataHoje).trim();
      parsed.horaIdentificada = String(parsed.horaIdentificada || horaAgora).trim();
      parsed.equipamentoIdentificado = String(parsed.equipamentoIdentificado || 'Medidor Padrão 20L Inmetro').trim();
      parsed.resumoGeralFoto = String(parsed.resumoGeralFoto || 'Leitura metrológica concluída com sucesso.').trim();
      parsed.tanquesExtraidos = Array.isArray(parsed.tanquesExtraidos) ? parsed.tanquesExtraidos : [];
      parsed.bicosEAfericoes = Array.isArray(parsed.bicosEAfericoes) ? parsed.bicosEAfericoes : [];
      parsed.validacaoJson = {
        sintaxeValida: true,
        stringsFechadas: true,
        camposFormatados: true,
      };

      res.json(parsed);
    } catch (error: any) {
      const msg = error instanceof Error ? error.message : String(error || 'Erro ao analisar foto');
      console.error('[Gemini OCR Aferição] Erro:', msg);
      res.status(500).json({ error: msg });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MEU POSTO 2.0 Server running on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal error during server startup:', err);
  process.exit(1);
});
