#!/usr/bin/env node
// Local bridge: receives scanned form fields, asks your Claude Code (Max auth)
// to match them against profile.json, returns the answers. No API key used.

const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 8731;
const HOST = '127.0.0.1';
const PROFILE_PATH = path.join(__dirname, '..', 'profile.json');

function loadProfile() {
  return fs.readFileSync(PROFILE_PATH, 'utf8');
}

function buildPrompt(profile, fields) {
  return `You are filling out a web form on behalf of a person. Everything known about them is in this JSON:

${profile}

Below are the form questions scanned from the page (JSON array). Each item has: id, question, type, and (for choice fields) options.

${JSON.stringify(fields, null, 2)}

For EACH question, decide the best answer using ONLY the person's data above.
Rules:
- type "text" or "paragraph": return a plain string suited to the question.
- type "radio" or "dropdown": return EXACTLY ONE of the given options, copied verbatim. If none fit, return null.
- type "checkbox": return an ARRAY of zero or more of the given options, copied verbatim.
- If you cannot answer truthfully from the data, return null. NEVER invent emails, phone numbers, names, roll numbers, or IDs that are not in the data.

Respond with ONLY a JSON object mapping each question id to its answer. No prose, no code fences.
Example: {"q0":"Jane Doe","q1":"jane.doe@example.com","q2":null,"q3":["Python","JavaScript"]}`;
}

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', prompt], { cwd: __dirname });
    let out = '', err = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(err.trim() || `claude exited ${code}`));
      resolve(out.trim());
    });
  });
}

function extractJson(text) {
  // Strip a ```json ... ``` fence if present, then grab the first {...} block.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('No JSON object found in Claude output: ' + text.slice(0, 300));
  }
  return JSON.parse(body.slice(start, end + 1));
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"ok":true}');
  }

  if (req.method !== 'POST' || req.url !== '/fill') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end('{"error":"not found"}');
  }

  let body = '';
  req.on('data', c => (body += c));
  req.on('end', async () => {
    try {
      const { fields } = JSON.parse(body || '{}');
      if (!Array.isArray(fields) || fields.length === 0) {
        throw new Error('Request must include a non-empty "fields" array');
      }
      const profile = loadProfile();
      let resumePath = null;
      try { resumePath = JSON.parse(profile).resume_path || null; } catch (_) {}
      const prompt = buildPrompt(profile, fields);
      console.log(`[fill] ${fields.length} field(s) -> asking claude...`);
      const raw = await runClaude(prompt);
      const answers = extractJson(raw);
      console.log('[fill] answers:', JSON.stringify(answers));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ answers, resumePath }));
    } catch (e) {
      console.error('[error]', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Form-filler bridge running on http://${HOST}:${PORT}`);
  console.log(`Profile: ${PROFILE_PATH}`);
  console.log('Keep this terminal open. Make sure `claude` is logged in (Max).');
});
