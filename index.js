import dotenv from 'dotenv'
import * as line from '@line/bot-sdk'
import express from 'express'
import mysql from 'mysql2/promise'
import swaggerUi from 'swagger-ui-express'
import swaggerJsdoc from 'swagger-jsdoc'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'

dotenv.config({ override: true })

const channelSecret = process.env.CHANNEL_SECRET || process.env.LINE_CHANNEL_SECRET;
const channelAccessToken = process.env.CHANNEL_ACCESS_TOKEN || process.env.LINE_CHANNEL_ACCESS_TOKEN;

const config = { channelSecret };

const client = line.LineBotClient.fromChannelAccessToken({
  channelAccessToken
});

const app = express();
let dbReady = false;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;
const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const gemini = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;
const geminiReplyModels = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];

// MySQL pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
});

async function initDB() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS line_users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(100) NOT NULL UNIQUE,
      display_name VARCHAR(255) NOT NULL,
      picture_url VARCHAR(500),
      status_message VARCHAR(500),
      last_login_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS game_scores (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(100) NOT NULL,
      display_name VARCHAR(255) NOT NULL,
      picture_url VARCHAR(500),
      score INT NOT NULL DEFAULT 0,
      level INT NOT NULL DEFAULT 1,
      bugs_defeated INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('DB ready');
  dbReady = true;
}

// ── Swagger ──────────────────────────────────────────────────────────────────
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Memory Leak API',
      version: '1.0.0',
    },
    servers: [
      { url: 'http://localhost:3014' },
      { url: 'http://parinwat.csbootstrap.com' },
    ],
    components: {
      schemas: {
        ProfileInput: {
          type: 'object',
          required: ['userId', 'displayName'],
          properties: {
            userId: { type: 'string' },
            displayName: { type: 'string' },
            pictureUrl: { type: 'string' },
            statusMessage: { type: 'string' },
          },
        },
        ScoreInput: {
          type: 'object',
          required: ['userId', 'score'],
          properties: {
            userId: { type: 'string' },
            displayName: { type: 'string' },
            pictureUrl: { type: 'string' },
            score: { type: 'integer' },
            level: { type: 'integer' },
            bugsDefeated: { type: 'integer' },
            playedSeconds: { type: 'integer' },
          },
        },
      },
    },
    paths: {
      '/api/profile': {
        post: {
          tags: ['Profile'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ProfileInput' },
              },
            },
          },
          responses: { 200: { description: 'OK' }, 400: { description: 'BAD_REQUEST' } },
        },
      },
      '/api/score': {
        post: {
          tags: ['Game'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ScoreInput' },
              },
            },
          },
          responses: { 200: { description: 'OK' }, 400: { description: 'BAD_REQUEST' } },
        },
      },
    },
  },
  apis: [],
});

const swaggerUiOptions = {
  customCss: `
    body { background: #0a0f0a; }
    .swagger-ui { font-family: 'Courier New', monospace; }
    .swagger-ui .topbar { background: #001a00; }
    .swagger-ui .topbar .download-url-wrapper { display: none; }
    .swagger-ui .info .title { color: #00ff41; }
  `,
  customSiteTitle: 'Memory Leak API Docs',
};
// ─────────────────────────────────────────────────────────────────────────────

app.use('/callback', express.raw({ type: '*/*' }));

app.get('/', (req, res) => {
  res.sendFile('chat.html', { root: 'public' });
});

app.get('/game', (req, res) => {
  res.sendFile('game.html', { root: 'public' });
});
app.get('/game/', (req, res) => {
  res.sendFile('game.html', { root: 'public' });
});
app.use('/game', express.static('public', { redirect: false }));

// Swagger routes (common style)
app.get('/swagger.json', (req, res) => res.json(swaggerSpec));
app.get('/swgger', (req, res) => res.redirect('/swagger'));
app.get('/swagger/index', (req, res) => res.redirect('/swagger'));
app.get('/swagger/index.html', (req, res) => res.redirect('/swagger'));
app.use('/swagger', swaggerUi.serve, swaggerUi.setup(swaggerSpec, swaggerUiOptions));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, swaggerUiOptions));

app.get('/api/config', (req, res) => {
  res.json({ liffId: process.env.LIFF_ID || '' });
});

app.get('/parinwat', (req, res) => {
  res.send('Hello Parinwat!');
});

app.get('/api/leaderboard', async (req, res) => {
  if (!dbReady) return res.json([]);
  try {
    const [rows] = await pool.execute(
      `SELECT
         gs.user_id,
         COALESCE(lu.display_name, MAX(gs.display_name)) AS display_name,
         COALESCE(lu.picture_url, MAX(gs.picture_url)) AS picture_url,
         SUM(gs.score) AS score,
         MAX(gs.level) AS level,
         SUM(gs.bugs_defeated) AS bugs_defeated,
         MAX(gs.created_at) AS created_at
       FROM game_scores gs
       LEFT JOIN line_users lu ON lu.user_id = gs.user_id
       GROUP BY gs.user_id, lu.display_name, lu.picture_url
       ORDER BY score DESC, created_at ASC
       LIMIT 10`
    );
    res.json(rows);
  } catch (err) {
    console.error('Leaderboard query failed:', err?.message || err);
    res.json([]);
  }
});

app.get('/api/history/:userId', async (req, res) => {
  const { userId } = req.params;
  if (!userId) return res.status(400).json({ error: 'invalid' });
  if (!dbReady) return res.json([]);
  try {
    const [rows] = await pool.execute(
      'SELECT user_id, display_name, picture_url, score, level, bugs_defeated, created_at FROM game_scores WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
      [userId]
    );
    res.json(rows);
  } catch (err) {
    console.error('History query failed:', err?.message || err);
    res.json([]);
  }
});

app.post('/api/profile', express.json(), async (req, res) => {
  const { userId, displayName, pictureUrl, statusMessage } = req.body;
  if (!userId || !displayName) return res.status(400).json({ error: 'invalid' });
  if (!dbReady) return res.json({ ok: false, dbSaved: false, error: 'db_not_ready' });
  try {
    await pool.execute(
      `INSERT INTO line_users (user_id, display_name, picture_url, status_message, last_login_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name),
         picture_url = VALUES(picture_url),
         status_message = VALUES(status_message),
         last_login_at = CURRENT_TIMESTAMP`,
      [userId, displayName, pictureUrl || '', statusMessage || '']
    );
    res.json({ ok: true, dbSaved: true });
  } catch (err) {
    console.error('Profile upsert failed:', err?.message || err);
    res.json({ ok: false, dbSaved: false, error: 'db_error' });
  }
});

app.post('/api/score', express.json(), async (req, res) => {
  const { userId, displayName, pictureUrl, score, level, bugsDefeated, playedSeconds } = req.body;
  if (!userId || score == null) return res.status(400).json({ error: 'invalid' });
  let dbSaved = true;
  let dbError = '';
  try {
    await pool.execute(
      'INSERT INTO game_scores (user_id, display_name, picture_url, score, level, bugs_defeated) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, displayName || 'Anonymous', pictureUrl || '', score, level || 1, bugsDefeated || 0]
    );
  } catch (err) {
    dbSaved = false;
    dbError = err?.message || 'DB insert failed';
    console.error('DB insert failed:', dbError);
  }

  const safeScore = Number(score) || 0;
  const safePlayedSeconds = Math.max(0, Number(playedSeconds) || 0);
  const mins = Math.floor(safePlayedSeconds / 60);
  const secs = safePlayedSeconds % 60;
  const playedText = `${mins}:${String(secs).padStart(2, '0')}`;

  let lineMessageSent = false;
  let lineError = '';
  try {
    await client.pushMessage({
      to: userId,
      messages: [{
        type: 'text',
        text: `ผลการเล่นเกม\nเวลาเล่น: ${playedText}\nคะแนน: ${safeScore}`,
      }],
    });
    lineMessageSent = true;
  } catch (err) {
    lineError = err?.message || 'LINE push failed';
    console.error('LINE push failed:', lineError);
  }

  res.json({ ok: true, dbSaved, dbError, lineMessageSent, lineError });
});

app.post('/api/chat', express.json(), async (req, res) => {
  const userMessage = String(req.body?.message || '').trim();
  const userId = String(req.body?.userId || 'web-user');
  if (!userMessage) return res.status(400).json({ ok: false, error: 'invalid_message' });
  if (!supabase) return res.status(503).json({ ok: false, error: 'supabase_not_configured' });

  const botReplyText = await generateGeminiTextReply(userMessage);
  const messageId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const { error } = await supabase
    .from('messages')
    .insert([
      {
        user_id: userId,
        message_id: messageId,
        type: 'text',
        content: userMessage,
        reply_token: 'web-chat',
        reply_content: botReplyText
      }
    ]);

  if (error) {
    console.error('Supabase insert failed for web chat:', error.message);
    return res.status(500).json({ ok: false, error: 'save_failed' });
  }

  return res.json({ ok: true, reply: botReplyText });
});

app.post('/callback', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error('Webhook error:', err.message);
      res.status(500).end();
    });
});

function toLineSafeText(text, fallback = 'ขออภัยครับ ระบบตอบกลับขัดข้องชั่วคราว') {
  const trimmed = String(text || '').trim();
  if (!trimmed) return fallback;
  return trimmed.length > 450 ? `${trimmed.slice(0, 447)}...` : trimmed;
}

async function generateWithGeminiFallback(contents, config) {
  let lastError = null;
  for (const model of geminiReplyModels) {
    try {
      return await gemini.models.generateContent({
        model,
        contents,
        config,
      });
    } catch (error) {
      lastError = error;
      console.warn(`Gemini model failed: ${model} ->`, error?.message || error);
    }
  }
  throw lastError || new Error('No Gemini model available');
}

async function generateGeminiTextReply(userText) {
  if (!gemini) return 'ตอนนี้ผู้ช่วยยังไม่พร้อมใช้งาน ลองใหม่อีกครั้งนะครับ';
  try {
    const response = await generateWithGeminiFallback(
      [
        {
          role: 'user',
          parts: [
            {
              text: `ช่วยตอบผู้ใช้ LINE แบบสั้น กระชับ เป็นภาษาไทย น้ำเสียงเป็นมิตร ไม่เกิน 2 ประโยค\n\nข้อความผู้ใช้: ${userText}`
            }
          ]
        }
      ],
      {
        temperature: 0.6,
        maxOutputTokens: 120,
      }
    );
    return toLineSafeText(response?.text, 'ขออภัยครับ ตอนนี้ยังตอบคำถามนี้ไม่ได้');
  } catch (error) {
    console.error('Gemini text generation failed:', error?.message || error);
    return 'ขออภัยครับ ระบบ AI ไม่พร้อมชั่วคราว';
  }
}

async function streamToBase64(readableStream) {
  const chunks = [];
  for await (const chunk of readableStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('base64');
}

async function detectAnimalFromLineImage(messageId) {
  if (!gemini) return 'ยังไม่สามารถวิเคราะห์สัตว์ได้ในตอนนี้';
  try {
    const contentStream = await client.getMessageContent(messageId);
    const imageBase64 = await streamToBase64(contentStream);
    if (!imageBase64) return 'ไม่พบข้อมูลรูปภาพสำหรับวิเคราะห์';

    const response = await generateWithGeminiFallback(
      [
        {
          role: 'user',
          parts: [
            { text: 'รูปนี้เป็นสัตว์ชนิดอะไร ตอบสั้นมาก ไม่เกิน 1 ประโยค ถ้าไม่แน่ใจให้บอกว่าไม่แน่ใจ' },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: imageBase64
              }
            }
          ]
        }
      ],
      {
        temperature: 0.2,
        maxOutputTokens: 60,
      }
    );

    return toLineSafeText(response?.text, 'ไม่แน่ใจว่าเป็นสัตว์ชนิดอะไร');
  } catch (error) {
    console.error('Gemini image analysis failed:', error?.message || error);
    return 'ยังวิเคราะห์ชนิดสัตว์ไม่ได้ในตอนนี้';
  }
}

async function handleEvent(event) {
  if (event.type !== 'message') return null;

  const userId = event?.source?.userId || 'unknown';
  const replyToken = event?.replyToken || '';
  const messageId = event?.message?.id || '';
  const messageType = event?.message?.type || 'unknown';
  const replyMessages = [];

  let content = null;
  let botReplyText = '';

  if (messageType === 'text') {
    content = event.message.text;
    botReplyText = await generateGeminiTextReply(content);
    replyMessages.push({ type: 'text', text: botReplyText });
  } else if (messageType === 'image') {
    content = `[Received image message: ${messageId}]`;
    const animalTypeText = await detectAnimalFromLineImage(messageId);
    replyMessages.push({ type: 'text', text: 'ได้รับรูปภาพสำเร็จครับ' });
    replyMessages.push({ type: 'text', text: `วิเคราะห์ภาพ: ${animalTypeText}` });
    botReplyText = `ได้รับรูปภาพสำเร็จครับ | วิเคราะห์ภาพ: ${animalTypeText}`;
  } else {
    content = `[Received ${messageType} message]`;
    botReplyText = `ได้รับข้อความประเภท ${messageType} แล้วครับ`;
    replyMessages.push({ type: 'text', text: botReplyText });
  }

  try {
    if (!supabase) {
      console.error('Supabase is not configured; skip reply because save must happen first.');
      return null;
    }

    const { error } = await supabase
      .from('messages')
      .insert([
        {
          user_id: userId,
          message_id: messageId,
          type: messageType,
          content,
          reply_token: replyToken,
          reply_content: botReplyText
        }
      ]);

    if (error) {
      console.error('Supabase insert failed:', error.message);
      return null;
    }

    if (!replyToken) return null;

    return await client.replyMessage({
      replyToken,
      messages: replyMessages,
    });
  } catch (error) {
    console.error('handleEvent failed:', error?.message || error);
    return null;
  }
}

const port = process.env.PORT || 3000;
initDB().then(() => {
  app.listen(port, () => {
    console.log(`http://localhost:${port}`);
    console.log(`API Docs → http://localhost:${port}/swagger`);
    console.log(`Swagger JSON → http://localhost:${port}/swagger.json`);
  });
}).catch(err => {
  console.error('DB init failed:', err.message);
  dbReady = false;
  app.listen(port, () => console.log(`http://localhost:${port} (no DB)`));
});
