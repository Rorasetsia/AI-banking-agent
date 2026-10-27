import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.mjs';
import { buildPlan, confirmPlan, cancelPlan, assessRisk, tickSchedules, publicState } from './engine.mjs';
import { resolveIntent } from './intent.mjs';
import { describeRecovery } from './recovery.mjs';
import { prepareTurn } from './conversation.mjs';
import { TransactionSecurity } from './transaction-security.mjs';
import { FamilyService, recordRiskEvent } from './family.mjs';
import { parseRules, unsafe } from './rules.mjs';
import { parseServiceText, runMandates } from './service-operations.mjs';
import {greenReport,setGreenConsent,updateGreenPreferences,setGreenOverride,parseGreenText,greenReply} from './green-finance.mjs';
import {greenGoals,createGreenGoal,recordGreenGoal,updateGreenGoal,cancelGreenGoal} from './green-goals.mjs';
import {calculateCommute,evaluateAppliance} from './green-decisions.mjs';
import { RISK_QUESTIONNAIRE, validRiskAnswers } from './risk-assessment.mjs';
import { isSavingsRequest, savingsTurn } from './savings-agent.mjs';
import { agentTopic, agentOverview, decorateAgentResult, agentTaskBundle } from './agent-tools.mjs';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BODY_LIMIT = 64 * 1024;
const TEXT_LIMIT = 2000;
const COOKIE_NAME = 'sid';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
});
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.woff': 'font/woff', '.woff2': 'font/woff2',
});

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function isBusinessError(error) {
  return Boolean(error) && Number.isInteger(error.status) && error.status >= 400 && error.status < 500;
}

function sendJson(res, status, payload, extra = {}) {
  if (res.writableEnded) return;
  if (res.headersSent) { try { res.end(); } catch { /* socket already closed */ } return; }
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extra,
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, code, message, recovery, metrics={}) {
  sendJson(res, status, { error: { code: code || 'REQUEST_FAILED', message: String(message || '请求无效'), recovery: recovery ?? describeRecovery(code) }, ...metrics });
}

function cookieValue(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return null; }
  }
  return null;
}

function hostInfo(header, publicOrigin) {
  if (typeof header !== 'string' || !header) return null;
  if(!/^[A-Za-z0-9.:[\]-]+$/.test(header))return null;
  try {
    const url = new URL(`http://${header}`);
    const hostname = url.hostname.toLowerCase();
    if (publicOrigin && url.host === new URL(publicOrigin).host) return { hostname, port: url.port || '443', remote: true };
    if (!LOOPBACK.has(hostname)) return null;
    return { hostname, port: url.port || '80' };
  } catch {
    return null;
  }
}

function originAllowed(origin, host, publicOrigin) {
  if(host.remote)return typeof origin==='string' && origin===publicOrigin;
  if (origin === undefined) return true;
  if (typeof origin !== 'string' || !origin) return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (!LOOPBACK.has(url.hostname.toLowerCase())) return false;
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    return port === host.port || port === '5173';
  } catch {
    return false;
  }
}

async function readJson(req, allowed) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const declared = Number(req.headers['content-length'] || 0);
  const chunked = Boolean(req.headers['transfer-encoding']);
  if (type !== 'application/json') {
    if (!type && declared === 0 && !chunked) return {};
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', '请求必须为 application/json');
  }
  if (Number.isFinite(declared) && declared > BODY_LIMIT) throw new HttpError(413, 'BODY_TOO_LARGE', '请求体超过 64KB');
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > BODY_LIMIT) throw new HttpError(413, 'BODY_TOO_LARGE', '请求体超过 64KB');
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'BODY_READ_FAILED', '无法读取请求体');
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  let body;
  try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'INVALID_JSON', '请求体不是有效 JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'INVALID_BODY', '请求体必须是 JSON 对象');
  const keys = Object.keys(body);
  if (keys.includes('userId') || keys.includes('steps')) throw new HttpError(403, 'FORBIDDEN_FIELD', '不接受客户端用户标识或执行参数');
  for (const key of keys) {
    if (!allowed.includes(key)) throw new HttpError(400, 'INVALID_FIELD', `不支持的字段：${key}`);
  }
  return body;
}

function nonceFrom(body) {
  if (typeof body.nonce !== 'string' || !body.nonce || body.nonce.length > 256) {
    throw new HttpError(400, 'INVALID_NONCE', '确认凭证无效');
  }
  return body.nonce;
}

export function createApp({ dbPath, apiKey, fetchImpl, publicOrigin, modelRequired = false } = {}) {
  if(publicOrigin){
    const url=new URL(publicOrigin);
    if(url.protocol!=='https:'||url.origin!==publicOrigin||url.username||url.password||LOOPBACK.has(url.hostname))throw new Error('BANK_PUBLIC_ORIGIN必须为精确的HTTPS站点来源，不含路径');
  }
  const distDir = resolve(PROJECT_ROOT, 'dist');
  const key = apiKey ?? process.env.DEEPSEEK_API_KEY ?? '';
  const database = dbPath === undefined
    ? resolve(PROJECT_ROOT, 'data/bank.sqlite')
    : dbPath === ':memory:' ? ':memory:' : resolve(PROJECT_ROOT, dbPath);
  const store = new Store(database);
  const security = new TransactionSecurity(store, { publicOrigin });
  const family = new FamilyService(store, security);
  const limits = new Map();
  const fetchOption = typeof fetchImpl === 'function' ? fetchImpl : undefined;

  function sessionFor(req) {
    const sid = cookieValue(req, COOKIE_NAME);
    return sid ? store.getSession(sid) : null;
  }

  function requireUser(req) {
    const session = sessionFor(req);
    if (!session) throw new HttpError(401, 'UNAUTHORIZED', '请先开启模拟环境会话');
    return session.userId;
  }

  function openSession(req, res) {
    const existing = sessionFor(req);
    if (existing) return existing.userId;
    if(publicOrigin){
      const bucket=`preview-sessions:${new Date().toISOString().slice(0,10)}`;
      const count=store.privateRead(bucket)?.count??0;
      if(count>=50)throw new HttpError(429,'PREVIEW_SESSION_LIMIT','今天的试用会话已达上限，请联系团队。');
      store.privateWrite(bucket,{count:count+1});
    }
    const created = store.createSession();
    const secure=publicOrigin && hostInfo(req.headers.host,publicOrigin)?.remote;
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${created.sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${secure?'; Secure':''}`);
    return created.userId;
  }

  function rateLimit(userId) {
    const now = Date.now();
    const entry = limits.get(userId);
    if (!entry || now - entry.start >= 60000) {
      limits.set(userId, { start: now, count: 1 });
    } else if (++entry.count > 60) {
      throw new HttpError(429, 'RATE_LIMITED', '请求过于频繁，请稍后再试');
    }
    if (limits.size > 2000) {
      for (const [id, value] of limits) if (now - value.start >= 60000) limits.delete(id);
    }
  }

  // 业务错误回滚后，用独立事务补记用户消息与错误消息，并清理旧 pending。
  // 补记本身失败不影响原始业务错误的返回。
  function recordChatFailure(userId, { text, at, intentSource, fallbackReason, error }) {
    const reply = String(error?.message || '请求未能完成，请稍后重试');
    const trace = Array.isArray(error?.trace) ? error.trace : [];
    try {
      store.update(userId, (state) => {
        if (!Array.isArray(state.messages)) state.messages = [];
        state.pending = null;
        state.messages.push({ id: randomUUID(), role: 'user', text, at });
        const assistant = {
          id: randomUUID(), role: 'assistant', text: reply, at, intentSource, trace,
          recovery: describeRecovery(error, text),
        };
        if (fallbackReason) assistant.fallbackReason = fallbackReason;
        state.messages.push(assistant);
        if (state.messages.length > 200) state.messages.splice(0, state.messages.length - 200);
        return null;
      });
    } catch { /* 记录失败时仍原样抛出业务错误 */ }
  }

  async function chat(req, res) {
    const userId = requireUser(req);
    const body = await readJson(req, ['text', 'mode']);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > TEXT_LIMIT) {
      throw new HttpError(400, 'INVALID_TEXT', `请输入 1 到 ${TEXT_LIMIT} 字的请求`);
    }
    if(/(?:交易密码|密码|验证码|口令)\s*(?:是|为|[:：=])?\s*[A-Za-z0-9!@#$%^&*_.-]{4,}/i.test(text)||/(?:银行卡号|身份证号)\s*(?:是|为|[:：=])?\s*\d{10,}/.test(text)){
      const reply='请不要在聊天中输入密码、验证码或真实敏感资料。本条疑似敏感输入已过滤，未发给模型；交易核验请使用安全表单。';
      store.update(userId,state=>{state.messages.push({id:randomUUID(),role:'user',text:'[疑似敏感输入已过滤]',at:new Date().toISOString()},{id:randomUUID(),role:'assistant',text:reply,at:new Date().toISOString(),intentSource:'rule'});});
      sendJson(res,200,{reply,intentSource:'rule',trace:['拦截疑似敏感输入，未调用模型']});return;
    }
    const mode = modelRequired ? 'llm' : body.mode ?? 'rule';
    if (mode !== 'rule' && mode !== 'llm') throw new HttpError(400, 'INVALID_MODE', '模式只能是 rule 或 llm');
    rateLimit(userId);
    // Cancellation is a separate committed transaction: neither an asynchronous
    // model response nor a later business rollback can revive old authorization.
    const turnId = randomUUID();
    const prepared = store.update(userId, state => {
      state.chatTurnId=turnId;
      // A savings draft has its own lifecycle; do not cancel a bank authorization
      // when the user only revises a non-financial savings calculation.
      if(isSavingsRequest(text,state) && (!state.plans.some(p=>p.status==='pending') || [...state.messages].reverse().find(m=>m.role==='assistant')?.agent?.kind==='savings' || /储蓄|攒|存钱/.test(text)))return null;
      return prepareTurn(state, text);
    });
    const before = store.read(userId);
    if (!before) throw new HttpError(401, 'UNAUTHORIZED', '会话已失效');
    const options = { apiKey: key, ...(fetchOption ? { fetchImpl: fetchOption } : {}) };
    const baseIntent = parseRules(text, before);
    const taskBundle=!prepared?agentTaskBundle(text,before):null;
    const savingsRequest = !unsafe(text) && !prepared && isSavingsRequest(text,before);
    const overviewTopic = !savingsRequest && !prepared ? agentTopic(text,before) : null;
    const routingText=text.replace(/(?:备注|附言)[^，,。；;]*/g,'');
    const greenRequest = !savingsRequest && !overviewTopic && !unsafe(text) ? parseGreenText(text,before) : null;
    const serviceRequest = !savingsRequest && !overviewTopic && !greenRequest && !unsafe(text) && (/委托|监测|每月检查|异常扣费|扣费异常|重复扣款|争议|申诉|客服|怎么|如何|为什么|多久|哪些|核验|验证|安全|隐私|密码|设备验证|人脸|指纹/.test(routingText) || ['clarify','help'].includes(baseIntent.kind)) ? parseServiceText(text,before) : null;
    let resolved;
    if (modelRequired && !prepared && !unsafe(text)) {
      if (!key) throw new HttpError(503, 'MODEL_NOT_CONFIGURED', 'DeepSeek尚未连接，请联系团队配置服务端模型后重试。');
      if(publicOrigin){
        const bucket=`preview-model:${new Date().toISOString().slice(0,10)}`;
        const count=store.privateRead(bucket)?.count??0;
        const configured=Number(process.env.BANK_MODEL_DAILY_LIMIT??100);
        const maximum=Number.isSafeInteger(configured)&&configured>0?Math.min(configured,1000):100;
        if(count>=maximum)throw new HttpError(503,'MODEL_DAILY_LIMIT','今天的试用AI次数已用完，请明天再试或联系团队。');
        store.privateWrite(bucket,{count:count+1});
      }
      resolved = await resolveIntent(text, before, { ...options, mode: 'llm' });
      if(resolved.intentSource !== 'llm') {
        const reason=String(resolved.fallbackReason??'模型响应不可用').replace(/[，,；;]?已(?:使用|转为|由)[\s\S]*$/,'');
        throw new HttpError(503,'MODEL_UNAVAILABLE',`${reason}。请重试，本轮没有生成新的办理方案。`);
      }
    } else if (prepared || taskBundle || greenRequest || serviceRequest || overviewTopic) {
      resolved = {intent:overviewTopic?{kind:'agent_overview',slots:{topic:overviewTopic}}:greenRequest ?? (serviceRequest?.kind ? serviceRequest : {kind:'clarify',slots:{}}),intentSource:'rule'};
    } else if (mode === 'llm' && !key) {
      const local = await resolveIntent(text, before, { ...options, mode: 'rule' });
      resolved = { ...local, intentSource: 'llm_fallback', fallbackReason: '未配置模型密钥，已使用本地规则' };
    } else {
      try {
        if(publicOrigin && mode==='llm' && key){
          const bucket=`preview-model:${new Date().toISOString().slice(0,10)}`;
          const count=store.privateRead(bucket)?.count??0;
          const configured=Number(process.env.BANK_MODEL_DAILY_LIMIT??100);
          const maximum=Number.isSafeInteger(configured)&&configured>0?Math.min(configured,1000):100;
          if(count>=maximum)throw Object.assign(new Error('今日试用模型次数已用完'),{previewBudget:true});
          store.privateWrite(bucket,{count:count+1});
        }
        resolved = await resolveIntent(text, before, { ...options, mode });
      } catch (error) {
        if (mode !== 'llm') throw error;
        const local = await resolveIntent(text, before, { ...options, mode: 'rule' });
        resolved = { ...local, intentSource: 'llm_fallback', fallbackReason: error.previewBudget?'今日试用模型次数已达上限，已使用本地规则':'模型调用失败，已使用本地规则' };
      }
    }
    const intentSource = ['rule', 'llm', 'llm_fallback'].includes(resolved?.intentSource)
      ? resolved.intentSource : (mode === 'llm' ? 'llm_fallback' : 'rule');
    let fallbackReason = typeof resolved?.fallbackReason === 'string' && resolved.fallbackReason
      ? resolved.fallbackReason : undefined;
    if (intentSource === 'llm_fallback' && !fallbackReason) fallbackReason = '模型不可用，已使用本地规则';
    const intent = resolved?.intent && typeof resolved.intent === 'object' && !Array.isArray(resolved.intent)
      ? resolved.intent : { kind: 'clarify', slots: {} };
    if (!intent.slots || typeof intent.slots !== 'object' || Array.isArray(intent.slots)) intent.slots = {};

    const at = new Date().toISOString();
    let payload;
    try {
      payload = store.update(userId, (state) => {
        if(state.chatTurnId!==turnId)return {reply:'这条请求已被后续对话取代，未生成或执行计划。',trace:['丢弃过时的意图结果，保留最新对话状态']};
        // 用户原文显式传入，不再借用 clarify.question 或向 intent.slots.question 回填用户文本
        if(!greenRequest&&state.green)delete state.green.chatDraft;
        if(greenRequest)state.pending=null;
        let result;
        if(prepared) result=prepared;
        else if(taskBundle)result=taskBundle;
        else if(!overviewTopic && (savingsRequest || intent.kind==='savings_plan')) {
          state.pending=null;
          result=savingsTurn(state,text,intent.kind==='savings_plan'?intent.slots:{});
        } else if(overviewTopic || intent.kind==='agent_overview') {
          state.pending=null;
          result=agentOverview(state,overviewTopic ?? intent.slots.topic);
        } else {
          // Switching to an explicit banking task stops only the active savings
          // clarification. Saved plans remain available for a later review.
          if(state.savingsAgent?.draft) state.savingsAgent.draft.active=false;
          result=greenRequest?.kind==='green_query' ? greenReply(state,greenRequest) : serviceRequest?.reply ? serviceRequest : buildPlan(state, intent, { rawText: text });
        }
        result=decorateAgentResult(state,result??{},intent);
        if (!Array.isArray(state.messages)) state.messages = [];
        state.messages.push({ id: randomUUID(), role: 'user', text, at });
        const assistant = {
          id: randomUUID(), role: 'assistant',
          text: String(result.reply || result.clarification?.question || '请补充信息。'),
          at, intentSource, trace: Array.isArray(result.trace) ? result.trace : [],
        };
        if (fallbackReason) assistant.fallbackReason = fallbackReason;
        if (result.plan?.id) { assistant.planId = result.plan.id; recordRiskEvent(state, result.plan); }
        if (result.sources) assistant.sources = result.sources;
        if (result.agent) assistant.agent = result.agent;
        state.messages.push(assistant);
        if (state.messages.length > 200) state.messages.splice(0, state.messages.length - 200);
        return result;
      });
    } catch (error) {
      // 仅处理业务 4xx：补记消息 + 清理旧 pending 后原样抛出，HTTP 仍返回真实业务错误；
      // 内部 500 等非业务错误不落消息、不伪装为用户错误。
      if (!isBusinessError(error)) throw error;
      recordChatFailure(userId, { text, at, intentSource, fallbackReason, error });
      error.recovery = describeRecovery(error, text);
      error.chatMetrics={intentSource,modelUsage:resolved.modelUsage??null,modelAttempted:resolved.modelAttempted===true};
      throw error;
    }

    const response = {
      reply: String(payload.reply || payload.clarification?.question || '请补充信息。'),
      trace: Array.isArray(payload.trace) ? payload.trace : [], intentSource,
    };
    if (payload.plan) response.plan = payload.plan;
    if (payload.clarification) response.clarification = payload.clarification;
    if (payload.answer) response.answer = payload.answer;
    if (payload.sources) response.sources = payload.sources;
    if (payload.agent) response.agent = payload.agent;
    if (fallbackReason) response.fallbackReason = fallbackReason;
    if (resolved.modelUsage) response.modelUsage = resolved.modelUsage;
    response.modelAttempted = resolved.modelAttempted === true;
    if (Number.isFinite(resolved.modelLatencyMs)) response.modelLatencyMs = resolved.modelLatencyMs;
    sendJson(res, 200, response);
  }

  async function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'METHOD_NOT_ALLOWED', '请求方法不被允许');
    if (!existsSync(distDir)) throw new HttpError(503, 'BUILD_REQUIRED', '前端尚未构建，请运行 npm run build 生成 dist');
    let realDist;
    try { realDist = realpathSync(distDir); } catch { throw new HttpError(503, 'BUILD_REQUIRED', '前端尚未构建，请运行 npm run build'); }
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { throw new HttpError(400, 'INVALID_PATH', '资源路径无效'); }
    if (decoded.includes('\0') || decoded.includes('\\')) throw new HttpError(404, 'NOT_FOUND', '资源不存在');
    const segments = decoded.split('/').filter(Boolean);
    if (segments.some((segment) => segment === '.' || segment === '..' || segment.startsWith('.'))) {
      throw new HttpError(404, 'NOT_FOUND', '资源不存在');
    }
    if (['src', 'server', 'data', 'node_modules'].includes(segments[0])) throw new HttpError(404, 'NOT_FOUND', '资源不存在');
    const extension = extname(segments.at(-1) || '').toLowerCase();
    if (extension === '.map') throw new HttpError(404, 'NOT_FOUND', '源映射不公开');
    const isAsset = Boolean(extension) || segments[0] === 'assets';
    const indexPath = resolve(distDir, 'index.html');
    const withinDist = (filePath) => {
      try {
        const real = realpathSync(filePath);
        return real === realDist || real.startsWith(realDist + sep) ? real : null;
      } catch { return null; }
    };
    let filePath;
    if (segments.length === 0) {
      filePath = indexPath;
    } else {
      const candidate = resolve(distDir, ...segments);
      if (candidate !== distDir && !candidate.startsWith(distDir + sep)) throw new HttpError(404, 'NOT_FOUND', '资源不存在');
      let isFile = false;
      try { isFile = statSync(candidate).isFile(); } catch { isFile = false; }
      if (isFile) filePath = candidate;
      else if (isAsset) throw new HttpError(404, 'NOT_FOUND', '资源不存在');
      else filePath = indexPath;
    }
    if (!existsSync(filePath)) {
      if (filePath === indexPath) throw new HttpError(503, 'BUILD_REQUIRED', '前端尚未构建，请运行 npm run build 生成 dist');
      throw new HttpError(404, 'NOT_FOUND', '资源不存在');
    }
    const realFile = withinDist(filePath);
    if (!realFile) throw new HttpError(404, 'NOT_FOUND', '资源不存在');
    filePath = realFile;
    const ext = extname(filePath).toLowerCase();
    if (ext === '.map') throw new HttpError(404, 'NOT_FOUND', '源映射不公开');
    const type = MIME[ext] || 'application/octet-stream';
    const data = await readFile(filePath);
    const headers = {
      ...SECURITY_HEADERS, 'Content-Type': type,
      'Cache-Control': filePath === indexPath ? 'no-cache' : 'public, max-age=3600',
    };
    if (type.startsWith('text/html')) headers['Content-Security-Policy'] = CSP;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  async function handle(req, res) {
    const host = hostInfo(req.headers.host,publicOrigin);
    if (!host) { sendError(res, 403, 'FORBIDDEN_HOST', '仅允许通过本机回环地址访问'); return; }
    let pathname;
    try { pathname = new URL(req.url || '/', 'http://localhost').pathname; }
    catch { sendError(res, 400, 'BAD_REQUEST', '请求地址无效'); return; }
    if (req.method === 'POST' && !originAllowed(req.headers.origin, host,publicOrigin)) {
      sendError(res, 403, 'FORBIDDEN_ORIGIN', '请求来源不被允许');
      return;
    }

    if (pathname === '/api/health') {
      if (req.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', '请求方法不被允许');
      sendJson(res, 200, { ok: true, now: new Date().toISOString() });
      return;
    }
    if (pathname === '/api/session') {
      if (req.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', '请求方法不被允许');
      const userId = openSession(req, res);
      const state = store.read(userId);
      if (!state) throw new HttpError(401, 'UNAUTHORIZED', '会话已失效');
      sendJson(res, 200, {
        user: { name: state.profile?.name || '模拟环境用户' }, mode: 'sandbox',
        llmConfigured: Boolean(key), now: state.now,
        ...(process.env.BANK_EPHEMERAL_PREVIEW==='1'?{persistence:'ephemeral'}:{}),
      });
      return;
    }
    if (pathname === '/api/state') {
      if (req.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', '请求方法不被允许');
      const currentUser = requireUser(req);
      store.update(currentUser, state => { runMandates(state); });
      const state = store.read(currentUser);
      if (!state) throw new HttpError(401, 'UNAUTHORIZED', '会话已失效');
      sendJson(res, 200, publicState(state));
      return;
    }
    if (pathname === '/api/security' || pathname.startsWith('/api/security/')) {
      const userId = requireUser(req);
      if (pathname === '/api/security' && req.method === 'GET') { sendJson(res, 200, { ...security.status(userId), policy: 'both' }); return; }
      if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', '请求方法不被允许');
      rateLimit(userId);
      const origin = req.headers.origin ?? (host.remote ? publicOrigin : `http://${req.headers.host}`);
      const planFor = body => {
        if (typeof body.planId !== 'string') throw new HttpError(400, 'INVALID_PLAN', '请指定待核验计划。');
        const plan = store.read(userId)?.plans.find(p => p.id === body.planId);
        if (!plan) throw new HttpError(404, 'PLAN_NOT_FOUND', '计划不存在。');
        return plan;
      };
      let result;
      if (pathname === '/api/security/password') result = security.setPassword(userId, await readJson(req, ['password','oldPassword']));
      else if (pathname === '/api/security/password-proof') { const body = await readJson(req, ['planId','password','riskAcknowledged']); result = security.passwordProof(userId, planFor(body), body.password, body.riskAcknowledged === true); }
      else if (pathname === '/api/security/devices/options') { const body = await readJson(req, ['password']); result = await security.registrationOptions(userId, body.password, origin); }
      else if (pathname === '/api/security/devices/register') { const body = await readJson(req, ['response','name']); result = await security.register(userId, body.response, body.name, origin); }
      else if (pathname === '/api/security/devices/remove') { const body = await readJson(req, ['deviceId','password']); result = security.removeDevice(userId, body.deviceId, body.password); }
      else if (pathname === '/api/security/device-options') { const body = await readJson(req, ['planId','riskAcknowledged']); result = await security.authenticationOptions(userId, planFor(body), origin, body.riskAcknowledged === true); }
      else if (pathname === '/api/security/device-proof') { const body = await readJson(req, ['planId','response']); result = await security.authenticate(userId, planFor(body), body.response, origin); }
      else throw new HttpError(404, 'NOT_FOUND', '安全接口不存在');
      sendJson(res, 200, result); return;
    }
    if (pathname === '/api/account/settings' || pathname === '/api/account/operation-code') {
      const userId = requireUser(req);
      const state = store.read(userId);
      if (!state) throw new HttpError(401, 'UNAUTHORIZED', '会话已失效');
      const securityStatus = security.status(userId);
      if (pathname === '/api/account/settings' && req.method === 'GET') {
        sendJson(res, 200, {
          displayName: state.profile?.name || '模拟环境用户',
          accountName: state.account?.name || '小苔活期账户',
          operationCodeConfigured: securityStatus.operationCodeConfigured,
          operationLockedUntil: securityStatus.operationLockedUntil,
          transactionPasswordConfigured: securityStatus.passwordConfigured,
          note: '操作码仅用于家庭提醒等非资金设置；转账、存取、理财、卡片与订阅变更仍需交易密码和已绑定设备。',
        });
        return;
      }
      if (pathname === '/api/account/operation-code' && req.method === 'POST') {
        rateLimit(userId);
        const result = security.setOperationCode(
          userId,
          await readJson(req, ['code', 'currentCode']),
        );
        sendJson(res, 200, result);
        return;
      }
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', '请求方法不被允许');
    }
    if (pathname === '/api/family' || pathname.startsWith('/api/family/')) {
      const userId = requireUser(req);
      if (pathname === '/api/family' && req.method === 'GET') { sendJson(res, 200, family.summary(userId)); return; }
      if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', '请求方法不被允许');
      rateLimit(userId);
      let result;
      if (pathname === '/api/family/invites') result = family.invite(userId, await readJson(req, ['relation','thresholdCents','shareAmount','consent','guardianConsent','operationCode']));
      else if (pathname === '/api/family/accept') result = family.accept(userId, await readJson(req, ['code','consent','operationCode']));
      else if (pathname === '/api/family/revoke') result = family.revoke(userId, await readJson(req, ['linkId','operationCode']));
      else if (pathname === '/api/family/preferences') result = family.preferences(userId, await readJson(req, ['largeAmountCents','operationCode']));
      else throw new HttpError(404, 'NOT_FOUND', '家庭接口不存在');
      sendJson(res, 200, result); return;
    }
    if (pathname === '/api/green' || pathname.startsWith('/api/green/')) {
      const userId=requireUser(req);
      if(pathname==='/api/green/goals'&&req.method==='GET'){
        sendJson(res,200,greenGoals(store.read(userId)));return;
      }
      if(pathname==='/api/green'&&req.method==='GET'){
        const month=new URL(req.url,'http://localhost').searchParams.get('month')??undefined;
        sendJson(res,200,greenReport(store.read(userId),month));return;
      }
      if(req.method!=='POST')throw new HttpError(405,'METHOD_NOT_ALLOWED','请求方法不被允许');
      rateLimit(userId);
      let result;
      if(pathname==='/api/green/decisions/commute'){
        result=calculateCommute(await readJson(req,['originalDailyCents','alternativeDailyCents','days','extraMinutes','maxExtraMinutes','dailyKm','originalMode','alternativeMode','originalMinutes','alternativeMinutes']));
      }else if(pathname==='/api/green/decisions/appliance'){
        result=evaluateAppliance(await readJson(req,['currentAnnualKwh','electricityPriceCents','years','replacementRequired','budgetCents','candidates']));
      }else if(pathname==='/api/green/goals'){
        const body=await readJson(req,['type','targetDays','useBankRecords']);result=store.update(userId,state=>createGreenGoal(state,body));
      }else if(pathname==='/api/green/goals/record'){
        const body=await readJson(req,['goalId','date','action']);result=store.update(userId,state=>recordGreenGoal(state,body));
      }else if(pathname==='/api/green/goals/update'){
        const body=await readJson(req,['goalId','targetDays','useBankRecords']);result=store.update(userId,state=>updateGreenGoal(state,body));
      }else if(pathname==='/api/green/goals/cancel'){
        const body=await readJson(req,['goalId']);result=store.update(userId,state=>cancelGreenGoal(state,body));
      }else if(pathname==='/api/green/consent'){
        const body=await readJson(req,['enabled']);result=store.update(userId,state=>setGreenConsent(state,body.enabled));
      }else if(pathname==='/api/green/preferences'){
        const body=await readJson(req,['maxExtraMinutes','requiredCarDays']);result=store.update(userId,state=>updateGreenPreferences(state,body));
      }else if(pathname==='/api/green/override'){
        const body=await readJson(req,['transactionId','category']);result=store.update(userId,state=>setGreenOverride(state,body.transactionId,body.category));
      }else throw new HttpError(404,'NOT_FOUND','绿色金融接口不存在');
      sendJson(res,200,result);return;
    }
    if (pathname === '/api/risk') {
      if (req.method === 'GET') { sendJson(res, 200, RISK_QUESTIONNAIRE); return; }
      if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', '请求方法不被允许');
      const userId = requireUser(req);
      const body = await readJson(req, ['answers']);
      if (!validRiskAnswers(body.answers)) {
        throw new HttpError(400, 'INVALID_ANSWERS', `风险问卷需完成全部 ${RISK_QUESTIONNAIRE.questions.length} 题并选择有效选项`);
      }
      const risk = store.update(userId, (state) => assessRisk(state, body.answers));
      sendJson(res, 200, { risk });
      return;
    }
    if (pathname === '/api/chat') {
      if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', '请求方法不被允许');
      await chat(req, res);
      return;
    }
    if (pathname === '/api/schedules/tick') {
      if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', '请求方法不被允许');
      const userId = requireUser(req);
      const body = await readJson(req, ['asOf']);
      if (typeof body.asOf !== 'string' || !Number.isFinite(Date.parse(body.asOf))) {
        throw new HttpError(400, 'INVALID_TIME', '演示时间无效');
      }
      const asOfMs = Date.parse(body.asOf);
      const result = store.update(userId, (state) => {
        const nowMs = Date.parse(state.now);
        if (!Number.isFinite(nowMs)) throw new HttpError(500, 'INVALID_CLOCK', '模拟环境时间不可用');
        if (asOfMs < nowMs) throw new HttpError(400, 'TICK_BACKWARDS', '演示时钟不能倒退');
        if (asOfMs > nowMs + 31 * 86400000) throw new HttpError(400, 'TICK_RANGE', '演示时钟最多向前推进31天');
        const result = tickSchedules(state, body.asOf, { requireAuthorization: true });
        runMandates(state);return result;
      });
      sendJson(res, 200, result);
      return;
    }
    if (pathname === '/api/reset') {
      if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', '请求方法不被允许');
      const userId = requireUser(req);
      await readJson(req, []);
      const fresh = store.reset(userId);
      sendJson(res, 200, publicState(fresh));
      return;
    }
    const planMatch = pathname.match(/^\/api\/plans\/([^/]+)\/(confirm|cancel)$/);
    if (planMatch) {
      if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', '请求方法不被允许');
      const userId = requireUser(req);
      const body = await readJson(req, planMatch[2] === 'confirm' ? ['nonce','proof','secondProof'] : ['nonce']);
      const nonce = nonceFrom(body);
      let planId;
      try { planId = decodeURIComponent(planMatch[1]); } catch { throw new HttpError(400, 'INVALID_PLAN', '计划编号无效'); }
      if (!planId || planId.length > 128) throw new HttpError(400, 'INVALID_PLAN', '计划编号无效');
      const result = planMatch[2] === 'cancel' ? store.update(userId, state => cancelPlan(state, planId, nonce)) : store.updateWithSecurity(userId, (state, sec) => {
        const plan = state.plans.find(p => p.id === planId);
        if (!plan) throw new HttpError(404, 'PLAN_NOT_FOUND', '计划不存在。');
        if (plan.nonce !== nonce) throw new HttpError(403, 'NONCE_MISMATCH', '确认凭证无效。');
        if (plan.status !== 'pending' && plan.status !== 'executed') return confirmPlan(state, planId, nonce);
        if (plan.status === 'pending' && (Date.parse(plan.expiresAt)<=Date.now() || Date.parse(plan.demoExpiresAt)<=Date.parse(state.now))) return confirmPlan(state, planId, nonce);
        if (plan.status !== 'executed') {
          const risk = security.consume(state, sec, plan, body.proof, { mode: 'both', secondProof: body.secondProof });
          plan.authentication = { methods: ['password','device'], verifiedAt: new Date().toISOString(), riskLevel: risk.level };
        }
        const result = confirmPlan(state, planId, nonce);
        recordRiskEvent(state, plan, 'executed');
        return result;
      });
      sendJson(res, 200, result);
      return;
    }
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      sendError(res, 404, 'NOT_FOUND', '接口不存在');
      return;
    }
    await serveStatic(req, res, pathname);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      const status = error instanceof HttpError ? error.status
        : Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
      const code = error instanceof HttpError ? error.code
        : status >= 500 ? 'INTERNAL' : (typeof error?.code === 'string' ? error.code : 'REQUEST_FAILED');
      const message = error instanceof HttpError ? error.message
        : status >= 500 ? '服务器暂时无法处理请求，请稍后重试' : String(error?.message || '请求无效');
      sendError(res, status, code, message, error?.recovery, error?.chatMetrics);
    });
  });

  let closing = null;
  async function close() {
    if (!closing) {
      closing = (async () => {
        try {
          if (server.listening) {
            await new Promise((resolveClose, rejectClose) => {
              server.close((error) => (error ? rejectClose(error) : resolveClose()));
              server.closeAllConnections?.();
            });
          }
        } finally {
          store.close();
        }
      })();
    }
    return closing;
  }

  return { server, store, close };
}

const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try { return resolve(entry) === fileURLToPath(import.meta.url); } catch { return false; }
})();

if (isMain) {
  const app = createApp({dbPath:process.env.BANK_DB_PATH,publicOrigin:process.env.BANK_PUBLIC_ORIGIN,modelRequired:true});
  app.server.listen(Number(process.env.PORT||8787), process.env.BANK_HOST||'127.0.0.1', () => {
    console.log(`Bank sandbox: ${process.env.BANK_PUBLIC_ORIGIN||'http://localhost:'+String(process.env.PORT||8787)}`);
  });
  const shutdown = () => { app.close().finally(() => process.exit(0)); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
