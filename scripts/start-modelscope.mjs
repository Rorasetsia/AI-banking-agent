// ModelScope Docker 适配层：
// 1) 若已显式提供 BANK_PUBLIC_ORIGIN，则原样保留，交由现有 createApp 校验；
// 2) 否则仅从 runtime 的 STUDIO_HOST 推导精确 https 来源（域名或 https://域名）；
// 3) 设定 PORT / BANK_EPHEMERAL_PREVIEW 默认值后转入现有 scripts/start-hosted.mjs。
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

await import('./start-hosted.mjs');
