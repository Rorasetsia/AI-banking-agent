// ModelScope Docker 适配层：
// 1) 若已显式提供 BANK_PUBLIC_ORIGIN，则原样保留，交由现有 createApp 校验；
// 2) 否则仅从 runtime 的 STUDIO_HOST 推导精确 https 来源（域名或 https://域名）；
// 3) 设定默认值后使用与原 hosted 入口相同的 createApp 校验与启动策略。
// 不修改、不绕过既有 host/Origin、Secure Cookie、WebAuthn RP 校验；不记录任何密钥。

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const EXACT_HTTPS_ORIGIN = /^https:\/\/([^/?#@:\\]+)$/i;

function fail(message) {
  throw new Error(message);
}

function normalizeHostname(rawHost) {
  const host = String(rawHost || '').trim().toLowerCase();
  if (!host) fail('STUDIO_HOST 为空：请填写 ModelScope 提供的访问域名。');
  if (host.length > 253) fail('STUDIO_HOST 过长，不是有效域名。');
  const labels = host.split('.');
  for (const label of labels) {
    if (label.length > 63 || !HOST_LABEL.test(label)) {
      fail('STUDIO_HOST 无效：只接受域名或 https://域名，不能包含端口、路径、查询参数、锚点或用户信息。');
    }
  }
  return host;
}

function originFromStudioHost(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) {
    fail('缺少 STUDIO_HOST：请设置 ModelScope 运行时域名，或显式配置 BANK_PUBLIC_ORIGIN。');
  }
  if (value.includes('://')) {
    const matched = EXACT_HTTPS_ORIGIN.exec(value);
    if (!matched) {
      fail('STUDIO_HOST 无效：只接受 https://域名 形式的精确来源，不能包含端口、路径、查询参数、锚点或用户信息。');
    }
    return `https://${normalizeHostname(matched[1])}`;
  }
  return `https://${normalizeHostname(value)}`;
}

if (!process.env.BANK_PUBLIC_ORIGIN) {
  process.env.BANK_PUBLIC_ORIGIN = originFromStudioHost(process.env.STUDIO_HOST);
}

process.env.PORT = process.env.PORT || '7860';
process.env.BANK_EPHEMERAL_PREVIEW = process.env.BANK_EPHEMERAL_PREVIEW || '1';

// The platform rewrites request headers before forwarding to the container.
// Capture only routing metadata, at most five times, without allowing new hosts.
const { createApp } = await import('../server/server.mjs');
const publicOrigin = process.env.BANK_PUBLIC_ORIGIN;
const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT无效');
const app = createApp({ publicOrigin, dbPath: process.env.BANK_DB_PATH || 'data/hosted-preview.sqlite', modelRequired: true });
const expectedHost = new URL(publicOrigin).host;
const routingLogs = new Set();
const safeHeader = value => typeof value === 'string'
  ? value.slice(0, 180).replace(/[^A-Za-z0-9.:,[\] _-]/g, '?') : null;
app.server.prependListener('request', req => {
  if (req.headers.host === expectedHost || routingLogs.size >= 5) return;
  const routing = JSON.stringify({
    host: safeHeader(req.headers.host),
    forwardedHost: safeHeader(req.headers['x-forwarded-host']),
    forwardedProto: safeHeader(req.headers['x-forwarded-proto']),
    originalHost: safeHeader(req.headers['x-original-host']),
    envoyOriginalHost: safeHeader(req.headers['x-envoy-original-host']),
    fcRequest: Boolean(req.headers['x-fc-request-id']),
    peer: safeHeader(req.socket.remoteAddress),
  });
  if (routingLogs.has(routing)) return;
  routingLogs.add(routing);
  console.warn('ModelScope host check: ' + routing);
});
app.server.listen(port, '0.0.0.0', () => console.log(`Bank preview ready: ${publicOrigin}`));
const shutdown = () => app.close().finally(() => process.exit(0));
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
