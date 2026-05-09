import 'dotenv/config'
import * as line from '@line/bot-sdk'
import express from 'express'
import mysql from 'mysql2/promise'
import swaggerUi from 'swagger-ui-express'
import swaggerJsdoc from 'swagger-jsdoc'

const config = { channelSecret: process.env.CHANNEL_SECRET };

const client = line.LineBotClient.fromChannelAccessToken({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN
});

const app = express();

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

app.use(express.static('public'));
app.use('/callback', express.raw({ type: '*/*' }));

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
});

app.get('/api/history/:userId', async (req, res) => {
  const { userId } = req.params;
  if (!userId) return res.status(400).json({ error: 'invalid' });
  const [rows] = await pool.execute(
    'SELECT user_id, display_name, picture_url, score, level, bugs_defeated, created_at FROM game_scores WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
    [userId]
  );
  res.json(rows);
});

app.post('/api/profile', express.json(), async (req, res) => {
  const { userId, displayName, pictureUrl, statusMessage } = req.body;
  if (!userId || !displayName) return res.status(400).json({ error: 'invalid' });
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
  res.json({ ok: true });
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

app.post('/callback', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error('Webhook error:', err.message);
      res.status(500).end();
    });
});

function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return Promise.resolve(null);
  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [{ type: 'text', text: event.message.text }],
  });
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
  app.listen(port, () => console.log(`http://localhost:${port} (no DB)`));
});
