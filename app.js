'use strict';
// AMSChat: a static chat page that streams from a llama-server (OpenAI-compatible API).

const params = new URLSearchParams(location.search);
const API = (params.get('api') || window.AMSCHAT_API || '').replace(/\/+$/, '');
const $ = sel => document.querySelector(sel);
const chat = $('#chat'), input = $('#input'), sendBtn = $('#send'), statusEl = $('#status');

const SYSTEM = 'You are AMSChat, a helpful assistant with a focus on analog/mixed-signal (AMS) circuit design, ' +
  'SerDes and high-speed links, and chip design generally. In circuit contexts, CML means current-mode logic. ' +
  'Answer clearly and concisely, use plain language for beginners, and say so when you are not sure.';

let history = [];
let controller = null;

// ---------------------------------------------------------------- status
async function checkStatus() {
  if (!API) return setStatus('offline', 'not configured');
  try {
    const r = await fetch(API + '/health', { cache: 'no-store' });
    if (r.ok) setStatus('online', 'online');
    else if (r.status === 503) setStatus('waking', 'waking up');
    else setStatus('offline', 'offline');
  } catch {
    setStatus('offline', 'offline');
  }
}
function setStatus(cls, text) {
  statusEl.className = 'status ' + cls;
  statusEl.textContent = text;
}

// ---------------------------------------------------------------- rendering
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
}

function render(md) {
  const out = [];
  const parts = md.split(/```/);
  parts.forEach((part, i) => {
    if (i % 2) {                                   // fenced code
      out.push(`<pre><code>${esc(part.replace(/^[\w+-]*\n/, ''))}</code></pre>`);
      return;
    }
    for (const block of part.split(/\n{2,}/)) {
      const lines = block.split('\n').filter(l => l.trim());
      if (!lines.length) continue;
      if (lines.every(l => /^\s*[-*] /.test(l))) {
        out.push('<ul>' + lines.map(l => `<li>${inline(l.replace(/^\s*[-*] /, ''))}</li>`).join('') + '</ul>');
      } else if (lines.every(l => /^\s*\d+[.)] /.test(l))) {
        out.push('<ol>' + lines.map(l => `<li>${inline(l.replace(/^\s*\d+[.)] /, ''))}</li>`).join('') + '</ol>');
      } else {
        out.push('<p>' + lines.map(l => inline(l.replace(/^#+\s*/, ''))).join('<br>') + '</p>');
      }
    }
  });
  return out.join('');
}

function addMessage(role, text) {
  $('#welcome')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + (role === 'user' ? 'user' : 'bot');
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (role === 'user') bubble.textContent = text;
  wrap.append(bubble);
  chat.append(wrap);
  chat.scrollTop = chat.scrollHeight;
  return { wrap, bubble };
}

// ---------------------------------------------------------------- chat
async function send(text) {
  text = text.trim();
  if (!text || controller) return;
  if (!API) {
    addMessage('bot', '').bubble.innerHTML = '<span class="error">AMSChat is not connected to a model yet.</span>';
    return;
  }
  input.value = '';
  autosize();
  addMessage('user', text);
  history.push({ role: 'user', content: text });

  const { wrap, bubble } = addMessage('bot', '');
  bubble.classList.add('cursor');
  let thoughtsEl = null, answer = '', thoughts = '';
  const started = performance.now();
  let tokens = 0;

  controller = new AbortController();
  sendBtn.textContent = 'Stop';
  sendBtn.classList.remove('primary');

  try {
    const r = await fetch(API + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        messages: [{ role: 'system', content: SYSTEM }, ...history.slice(-12)],
        stream: true,
        max_tokens: 1024,
        temperature: 0.6,
        chat_template_kwargs: { enable_thinking: $('#think').checked },
      }),
    });
    if (!r.ok) throw new Error(r.status === 503 ? 'The model is waking up; try again in a few seconds.' : `Server error ${r.status}`);
    setStatus('online', 'online');
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
        let delta;
        try { delta = JSON.parse(line.slice(6)).choices?.[0]?.delta || {}; } catch { continue; }
        if (delta.reasoning_content) {
          if (!thoughtsEl) {
            thoughtsEl = document.createElement('details');
            thoughtsEl.className = 'thoughts';
            thoughtsEl.innerHTML = '<summary>Working…</summary><div></div>';
            wrap.insertBefore(thoughtsEl, bubble);
          }
          thoughts += delta.reasoning_content;
          thoughtsEl.lastChild.textContent = thoughts.trim();
          if (delta.reasoning_content.includes('🔧')) {     // a tool started: keep the steps visible
            thoughtsEl.open = true;
            thoughtsEl.firstChild.textContent = 'Running SerDes tools…';
          }
        }
        if (delta.content) {
          answer += delta.content;
          tokens++;
          bubble.innerHTML = render(answer);
        }
      }
      chat.scrollTop = chat.scrollHeight;
    }
    if (thoughtsEl) {
      const used = [...new Set([...thoughts.matchAll(/🔧 (\w+)\(/g)].map(m => m[1]))];
      thoughtsEl.firstChild.textContent = used.length ? `Used ${used.join(', ')}` : 'Thoughts';
    }
    history.push({ role: 'assistant', content: answer });
    const secs = (performance.now() - started) / 1000;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${secs.toFixed(1)} s`;
    wrap.append(meta);
  } catch (err) {
    if (err.name === 'AbortError') {
      if (answer) history.push({ role: 'assistant', content: answer });
    } else {
      bubble.innerHTML = (answer ? render(answer) : '') +
        `<p class="error">${esc(err.message === 'Failed to fetch' ? 'Could not reach the model. The PC hosting AMSChat is probably asleep or off; try again later.' : err.message)}</p>`;
      history.pop();
      checkStatus();
    }
  } finally {
    bubble.classList.remove('cursor');
    if (!answer && !bubble.innerHTML) bubble.innerHTML = '<span class="meta">(stopped)</span>';
    controller = null;
    sendBtn.textContent = 'Send';
    sendBtn.classList.add('primary');
    input.focus();
  }
}

function autosize() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 180) + 'px';
  input.style.overflowY = input.scrollHeight > 180 ? 'auto' : 'hidden';
}

// ---------------------------------------------------------------- wiring
$('#composer').addEventListener('submit', e => {
  e.preventDefault();
  if (controller) controller.abort();
  else send(input.value);
});
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (!controller) send(input.value);
  }
});
input.addEventListener('input', autosize);
document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => send(c.textContent)));
$('#new-chat').addEventListener('click', () => {
  if (controller) controller.abort();
  history = [];
  chat.innerHTML = '';
  location.hash = '';
  location.reload();
});

checkStatus();
setInterval(checkStatus, 30000);
input.focus();
