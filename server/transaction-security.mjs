import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { assessOperationRisk } from './operation-risk.mjs';

const fail = (code, message, status = 403) => { throw Object.assign(new Error(message), { code, status }); };
const digest = value => createHash('sha256').update(value).digest('hex');
const keyFor = userId => `security:${userId}`;
const blank = () => ({
  version: 1,
  credentials: [],
  proofs: [],
  failures: 0,
  lockedUntil: 0,
  operationFailures: 0,
  operationLockedUntil: 0,
});
const derive = (value, salt) => scryptSync(value, salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
const validPassword = value => typeof value === 'string' && value.length >= 8 && value.length <= 64 && /[A-Za-z]/.test(value) && /\d/.test(value);
const validOperationCode = value => typeof value === 'string' && /^\d{6}$/.test(value);

export function planFingerprint(plan, version) {
  return digest(JSON.stringify({ id: plan.id, nonce: plan.nonce, steps: plan.steps, expiresAt: plan.expiresAt, version }));
}

export class TransactionSecurity {
  constructor(store, { publicOrigin } = {}) { this.store = store; this.publicOrigin = publicOrigin; }
  read(userId) { return this.store.privateRead(keyFor(userId)) ?? blank(); }
  save(userId, value) { this.store.privateWrite(keyFor(userId), value); }
  status(userId) {
    const s = this.read(userId);
    return {
      passwordConfigured: Boolean(s.passwordHash),
      lockedUntil: s.lockedUntil ?? 0,
      operationCodeConfigured: Boolean(s.operationCodeHash),
      operationLockedUntil: s.operationLockedUntil ?? 0,
      devices: (s.credentials ?? []).map(c => ({ id: c.id, name: c.name, createdAt: c.createdAt, rpId: c.rpId })),
      note: '设备验证由系统选择指纹、人脸或设备PIN；本系统不接收生物特征。仅为沙箱交易核验，非银行实名认证。',
    };
  }
  setOperationCode(userId, { code, currentCode }) {
    if (!validOperationCode(code)) fail('WEAK_OPERATION_CODE', '操作码需为6位数字，请勿与交易密码相同。', 400);
    let s = this.read(userId);
    if (s.operationCodeHash) {
      if (typeof currentCode !== 'string' || currentCode.length === 0) {
        fail('OPERATION_CODE_REQUIRED', '修改操作码需要先输入当前操作码。');
      }
      s = this.checkOperationCode(userId, currentCode);
    }
    s.operationSalt = randomBytes(24).toString('hex');
    s.operationCodeHash = derive(code, s.operationSalt);
    s.operationFailures = 0;
    s.operationLockedUntil = 0;
    this.save(userId, s);
    return this.status(userId);
  }
  checkOperationCode(userId, code) {
    const s = this.read(userId);
    if (!s.operationCodeHash) {
      fail('OPERATION_CODE_SETUP_REQUIRED', '请先在账号设置中创建6位操作码。', 409);
    }
    if (s.operationLockedUntil > Date.now()) {
      fail('OPERATION_CODE_LOCKED', '操作码连续验证失败，已锁定10分钟。', 429);
    }
    const valid = validOperationCode(code)
      && timingSafeEqual(
        Buffer.from(derive(code, s.operationSalt), 'hex'),
        Buffer.from(s.operationCodeHash, 'hex'),
      );
    if (!valid) {
      s.operationFailures = (s.operationFailures ?? 0) + 1;
      if (s.operationFailures >= 5) {
        s.operationLockedUntil = Date.now() + 600000;
        s.operationFailures = 0;
      }
      this.save(userId, s);
      fail(
        'INVALID_OPERATION_CODE',
        s.operationLockedUntil > Date.now()
          ? '操作码连续验证失败，已锁定10分钟。'
          : '操作码不正确。',
        s.operationLockedUntil > Date.now() ? 429 : 403,
      );
    }
    s.operationFailures = 0;
    s.operationLockedUntil = 0;
    this.save(userId, s);
    return s;
  }
  checkPassword(userId, password) {
    const s = this.read(userId);
    if (!s.passwordHash) fail('SECURITY_SETUP_REQUIRED', '请先在安全中心设置沙箱交易密码。', 409);
    if (s.lockedUntil > Date.now()) fail('SECURITY_LOCKED', '交易核验已暂时锁定，请10分钟后再试。', 429);
    const valid = typeof password === 'string' && password.length <= 64 && timingSafeEqual(Buffer.from(derive(password, s.salt), 'hex'), Buffer.from(s.passwordHash, 'hex'));
    if (!valid) {
      s.failures = (s.failures ?? 0) + 1;
      if (s.failures >= 5) { s.lockedUntil = Date.now() + 600000; s.failures = 0; }
      this.save(userId, s);
      fail('INVALID_TRANSACTION_PASSWORD', s.lockedUntil > Date.now() ? '核验连续失败，已锁定10分钟。' : '交易密码不正确。');
    }
    s.failures = 0; s.lockedUntil = 0; this.save(userId, s);
    return s;
  }
  setPassword(userId, { password, oldPassword }) {
    if (!validPassword(password)) fail('WEAK_PASSWORD', '交易密码需8—64位，至少包含字母和数字；不要使用真实银行卡密码。', 400);
    let s = this.read(userId);
    if (s.passwordHash) s = this.checkPassword(userId, oldPassword);
    s.salt = randomBytes(24).toString('hex'); s.passwordHash = derive(password, s.salt);
    s.version = (s.version ?? 0) + 1; s.proofs = []; s.registration = null; s.authentication = null;
    this.save(userId, s);
    return this.status(userId);
  }
  issueProof(userId, plan, method, riskAcknowledged) {
    const state = this.store.read(userId), s = this.read(userId);
    if (!state || !s.passwordHash) fail('SECURITY_SETUP_REQUIRED', '请先设置交易密码。', 409);
    if (plan.status !== 'pending' || Date.parse(plan.expiresAt) <= Date.now() || Date.parse(plan.demoExpiresAt) <= Date.parse(state.now)) fail('PLAN_EXPIRED', '计划不可核验，请重新核对。', 409);
    const risk = assessOperationRisk(state, plan);
    if (risk.level === 'high' && !riskAcknowledged) fail('RISK_ACK_REQUIRED', '请先阅读并确认高风险提示。', 409);
    const proof = randomBytes(32).toString('hex');
    s.proofs = (s.proofs ?? []).filter(p => p.expiresAt > Date.now()).slice(-9);
    s.proofs.push({ hash: digest(proof), fingerprint: planFingerprint(plan, s.version), method, riskAcknowledged: Boolean(riskAcknowledged), riskLevel: risk.level, expiresAt: Date.now() + 90000 });
    this.save(userId, s);
    return { proof, expiresAt: Date.now() + 90000, risk };
  }
  passwordProof(userId, plan, password, riskAcknowledged) {
    this.checkPassword(userId, password);
    return this.issueProof(userId, plan, 'password', riskAcknowledged);
  }
  consume(state, security, plan, proof, { mode = 'either', secondProof } = {}) {
    const risk = assessOperationRisk(state, plan);
    if (!security.passwordHash) fail('SECURITY_SETUP_REQUIRED', '请先在安全中心设置沙箱交易密码。', 409);
    if (security.lockedUntil > Date.now()) fail('SECURITY_LOCKED', '核验暂时锁定，请稍后再试。', 429);
    const fingerprint = planFingerprint(plan, security.version);
    const lookup = token => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) ? (security.proofs ?? []).find(p => p.hash === digest(token) && p.fingerprint === fingerprint && p.expiresAt > Date.now()) : null;
    const first = lookup(proof), second = lookup(secondProof);
    if (!first) fail('TRANSACTION_AUTH_REQUIRED', '请在核对方案后，使用交易密码或设备完成二次核验。');
    const factors = mode === 'both' ? [first, second] : [first];
    if (mode === 'both' && (!second || first === second || !factors.some(p => p.method === 'password') || !factors.some(p => p.method === 'device'))) fail('TWO_FACTORS_REQUIRED', '本次需要交易密码与设备验证同时完成。');
    if (risk.level === 'high' && (!first.riskAcknowledged || (mode === 'either' && first.method !== 'password'))) fail('HIGH_RISK_AUTH_REQUIRED', '高风险操作需阅读风险提示并使用交易密码加强核验。');
    security.proofs = (security.proofs ?? []).filter(p => !factors.includes(p));
    return risk;
  }
  async registrationOptions(userId, password, origin) {
    const s = this.checkPassword(userId, password);
    const rpId = this.rpId(origin);
    if (s.credentials.length >= 5) fail('DEVICE_LIMIT', '最多绑定5个设备凭据，请先移除不用的凭据。', 409);
    const options = await generateRegistrationOptions({ rpName: '小苔银行沙箱', rpID: rpId, userName: userId, userID: new TextEncoder().encode(userId), attestationType: 'none', supportedAlgorithmIDs: [-7,-257], authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' }, excludeCredentials: s.credentials.map(c => ({ id: c.id, transports: c.transports })) });
    const current = this.read(userId);
    if (current.version !== s.version) fail('SECURITY_CHANGED', '安全设置已变化，请重试。', 409);
    current.registration = { challenge: options.challenge, origin, rpId, version: s.version, expiresAt: Date.now() + 120000 };
    this.save(userId, current); return options;
  }
  rpId(origin) {
    const url = new URL(origin);
    if(this.publicOrigin && origin===this.publicOrigin && url.protocol==='https:')return url.hostname;
    if (url.hostname !== 'localhost') fail('DEVICE_ORIGIN_UNSUPPORTED', '本机设备验证请使用 http://localhost:8787；127.0.0.1上的账户与localhost账户不同。正式部署需固定HTTPS域名。', 409);
    return url.hostname;
  }
  async register(userId, response, name, origin) {
    let s = this.read(userId); const pending = s.registration;
    s.registration = null; this.save(userId, s);
    if (!pending || pending.origin !== origin || pending.expiresAt <= Date.now() || pending.version !== s.version) fail('CHALLENGE_EXPIRED', '设备绑定已过期，请重新开始。', 409);
    let checked;
    try { checked = await verifyRegistrationResponse({ response, expectedChallenge: pending.challenge, expectedOrigin: origin, expectedRPID: pending.rpId, requireUserVerification: true }); }
    catch { fail('DEVICE_VERIFY_FAILED', '设备注册未通过校验，未保存凭据。'); }
    if (!checked.verified || !checked.registrationInfo?.userVerified) fail('DEVICE_VERIFY_FAILED', '设备未完成用户验证。');
    const credential = checked.registrationInfo.credential;
    s = this.read(userId);
    if (s.version !== pending.version) fail('SECURITY_CHANGED', '安全设置已变化，请重试。', 409);
    if (s.credentials.some(c => c.id === credential.id)) fail('DEVICE_ALREADY_BOUND', '该凭据已绑定。', 409);
    s.credentials.push({ id: credential.id, publicKey: Buffer.from(credential.publicKey).toString('base64url'), counter: credential.counter, transports: credential.transports, rpId: pending.rpId, name: typeof name === 'string' ? name.trim().slice(0, 40) || '我的设备' : '我的设备', createdAt: new Date().toISOString() });
    this.save(userId, s); return this.status(userId);
  }
  async authenticationOptions(userId, plan, origin, riskAcknowledged) {
    const s = this.read(userId), rpId = this.rpId(origin);
    if (s.lockedUntil > Date.now()) fail('SECURITY_LOCKED', '核验暂时锁定。', 429);
    const credentials = s.credentials.filter(c => c.rpId === rpId);
    if (!credentials.length) fail('DEVICE_NOT_BOUND', '请先在安全中心绑定设备，或使用交易密码。', 409);
    const options = await generateAuthenticationOptions({ rpID: rpId, allowCredentials: credentials.map(c => ({ id: c.id, transports: c.transports })), userVerification: 'required' });
    const current = this.read(userId);
    if (current.version !== s.version) fail('SECURITY_CHANGED', '安全设置已变化。', 409);
    current.authentication = { challenge: options.challenge, origin, rpId, planId: plan.id, fingerprint: planFingerprint(plan, s.version), version: s.version, riskAcknowledged: Boolean(riskAcknowledged), expiresAt: Date.now() + 120000 };
    this.save(userId, current); return options;
  }
  async authenticate(userId, plan, response, origin) {
    let s = this.read(userId); const pending = s.authentication;
    s.authentication = null; this.save(userId, s);
    const credential = s.credentials.find(c => c.id === response?.id);
    if (!credential || !pending || pending.origin !== origin || pending.planId !== plan.id || pending.fingerprint !== planFingerprint(plan, s.version) || pending.expiresAt <= Date.now()) fail('CHALLENGE_EXPIRED', '设备核验已失效，请重新开始。', 409);
    let checked;
    try { checked = await verifyAuthenticationResponse({ response, expectedChallenge: pending.challenge, expectedOrigin: origin, expectedRPID: pending.rpId, credential: { id: credential.id, publicKey: new Uint8Array(Buffer.from(credential.publicKey, 'base64url')), counter: credential.counter, transports: credential.transports }, requireUserVerification: true }); }
    catch { fail('DEVICE_VERIFY_FAILED', '设备签名或用户验证未通过。'); }
    if (!checked.verified || !checked.authenticationInfo.userVerified) fail('DEVICE_VERIFY_FAILED', '设备核验失败。');
    s = this.read(userId);
    if (s.version !== pending.version) fail('SECURITY_CHANGED', '安全配置变化，请重新核验。', 409);
    const current = s.credentials.find(c => c.id === credential.id);
    if (!current || current.counter !== credential.counter) fail('DEVICE_CHANGED', '设备状态变化，请重试。', 409);
    current.counter = checked.authenticationInfo.newCounter; this.save(userId, s);
    return this.issueProof(userId, plan, 'device', pending.riskAcknowledged);
  }
  removeDevice(userId, deviceId, password) {
    const s = this.checkPassword(userId, password);
    if (!s.credentials.some(c => c.id === deviceId)) fail('DEVICE_NOT_FOUND', '没有找到该设备。', 404);
    s.credentials = s.credentials.filter(c => c.id !== deviceId); s.version += 1; s.proofs = []; s.authentication = null; s.registration = null;
    this.save(userId, s); return this.status(userId);
  }
}
