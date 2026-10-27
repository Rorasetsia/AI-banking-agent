import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { assessOperationRisk } from './operation-risk.mjs';

const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }); };
const hash = text => createHash('sha256').update(text).digest('hex');
export function ensureFamily(state) {
  state.familyLinks ??= [];
  state.riskEvents ??= [];
  state.alertPreferences ??= { largeAmountCents: 300000 };
}
export function recordRiskEvent(state, plan, phase = 'proposed') {
  ensureFamily(state);
  const risk = assessOperationRisk(state, plan);
  const id = `${plan.id}:${phase}`;
  if (state.riskEvents.some(e => e.id === id)) return;
  state.riskEvents.push({ id, planId: plan.id, amountCents: risk.maxAmountCents, riskLevel: risk.level, reasonCodes: risk.reasons.map(r => r.code), phase, at: new Date().toISOString(), demoAt: state.now });
  if (state.riskEvents.length > 300) state.riskEvents.splice(0, state.riskEvents.length - 300);
}

export class FamilyService {
  constructor(store, security) { this.store = store; this.security = security; }
  invite(userId, body) {
    this.security.checkOperationCode(userId, body.operationCode);
    if (body.consent !== true) fail('FAMILY_CONSENT_REQUIRED', '需本人明确同意向家庭管理人分享所选提醒。');
    if (!['parent', 'child', 'partner', 'other'].includes(body.relation)) fail('INVALID_RELATION', '请选择家庭关系。');
    if (body.relation === 'child' && body.guardianConsent !== true) fail('GUARDIAN_CONSENT_REQUIRED', '儿童演示档案需要监护人同意；本项目不验证现实监护身份，请勿录入真实儿童信息。');
    if (!Number.isSafeInteger(body.thresholdCents) || body.thresholdCents < 1 || body.thresholdCents > 1000000000) fail('INVALID_THRESHOLD', '大额提醒线需为0.01—10,000,000元。');
    if (typeof body.shareAmount !== 'boolean') fail('INVALID_CONSENT_SCOPE', '请选择是否向管理人分享金额。');
    const state = this.store.read(userId); ensureFamily(state);
    if (state.familyLinks.filter(l => l.status === 'active').length >= 10) fail('FAMILY_LIMIT', '最多绑定10个家庭关系。', 409);
    const code = randomBytes(12).toString('hex');
    const expiresAt = Date.now() + 1800000;
    this.store.privateWrite(`family-invite:${hash(code)}`, { ownerId: userId, relation: body.relation, thresholdCents: body.thresholdCents, shareAmount: body.shareAmount, expiresAt, consumed: false, consentAt: new Date().toISOString() });
    return { code, expiresAt, note: '请仅把邀请码交给希望接收提醒的管理人；对方仍需在自己的会话中同意。30分钟有效。' };
  }
  accept(userId, body) {
    this.security.checkOperationCode(userId, body.operationCode);
    if (body.consent !== true) fail('FAMILY_CONSENT_REQUIRED', '需同意仅接收授权范围的提醒，不因此取得资金操作或完整账单权限。');
    if (typeof body.code !== 'string' || !/^[a-f0-9]{24}$/.test(body.code)) fail('INVALID_INVITE', '邀请码无效或已过期。');
    const key = `family-invite:${hash(body.code)}`;
    const invitation = this.store.privateRead(key);
    if (!invitation || invitation.consumed || invitation.expiresAt <= Date.now()) fail('INVALID_INVITE', '邀请码无效或已过期。');
    if (invitation.ownerId === userId) fail('SELF_BINDING', '请由另一个独立会话接收家庭邀请。');
    return this.store.withUsers([invitation.ownerId, userId], ([owner, manager]) => {
      const current = this.store.privateRead(key);
      if (!current || current.consumed || current.expiresAt <= Date.now()) fail('INVALID_INVITE', '邀请码无效或已过期。');
      ensureFamily(owner); ensureFamily(manager);
      if ([owner, manager].some(s => s.familyLinks.filter(l => l.status === 'active').length >= 10)) fail('FAMILY_LIMIT', '绑定数量已达上限。', 409);
      if (owner.familyLinks.some(l => l.peerId === userId && l.role === 'member' && l.status === 'active')) fail('ALREADY_BOUND', '双方已有该方向的提醒关系。', 409);
      const id = `family-${randomUUID()}`, consentAt = new Date().toISOString();
      const scope = { id, status: 'active', relation: current.relation, thresholdCents: current.thresholdCents, shareAmount: current.shareAmount, consentAt };
      owner.familyLinks.push({ ...scope, peerId: userId, role: 'member' });
      manager.familyLinks.push({ ...scope, peerId: owner.userId, role: 'manager' });
      current.consumed = true; this.store.privateWrite(key, current);
      return { id, status: 'active', note: '提醒绑定已生效，不共享账户余额、完整流水、密码或交易权限。' };
    });
  }
  revoke(userId, body) {
    this.security.checkOperationCode(userId, body.operationCode);
    const state = this.store.read(userId); ensureFamily(state);
    const link = state.familyLinks.find(l => l.id === body.linkId);
    if (!link) fail('FAMILY_NOT_FOUND', '家庭关系不存在。', 404);
    return this.store.withUsers([userId, link.peerId], states => {
      for (const s of states) {
        ensureFamily(s);
        const item = s.familyLinks.find(l => l.id === body.linkId);
        if (item) { item.status = 'revoked'; item.revokedAt = new Date().toISOString(); }
      }
      return { status: 'revoked', note: '已停止向对方提供提醒；对方不再能通过本系统查看原共享事件。' };
    });
  }
  preferences(userId, body) {
    this.security.checkOperationCode(userId, body.operationCode);
    if (!Number.isSafeInteger(body.largeAmountCents) || body.largeAmountCents < 1 || body.largeAmountCents > 1000000000) fail('INVALID_THRESHOLD', '请输入合法的大额提醒线。');
    this.store.update(userId, state => { ensureFamily(state); state.alertPreferences.largeAmountCents = body.largeAmountCents; });
    return { largeAmountCents: body.largeAmountCents, note: '个人风险提醒线已更新；已同意的家庭分享阈值不自动扩大。' };
  }
  summary(userId) {
    const state = this.store.read(userId); ensureFamily(state);
    const alerts = [];
    const links = [];
    for (const link of state.familyLinks.filter(l => l.status === 'active')) {
      const peer = this.store.read(link.peerId);
      if (!peer) continue;
      const reciprocal = peer.familyLinks?.find(l => l.id === link.id && l.peerId === userId && l.status === 'active');
      if (!reciprocal) continue;
      links.push({ id: link.id, relation: link.relation, role: link.role, thresholdCents: link.thresholdCents, shareAmount: link.shareAmount, consentAt: link.consentAt });
      if (link.role !== 'manager') continue;
      for (const event of peer.riskEvents ?? []) {
        if (event.at < link.consentAt || (event.amountCents < link.thresholdCents && !event.reasonCodes.includes('SCAM_CUE'))) continue;
        alerts.push({ id: `${link.id}:${event.id}`, linkId: link.id, relation: link.relation, phase: event.phase, at: event.at, demoAt: event.demoAt, ...(link.shareAmount ? { amountCents: event.amountCents } : {}), title: event.reasonCodes.includes('SCAM_CUE') ? '家庭成员操作含待核查风险线索' : '家庭成员操作达到约定大额线', note: '仅为规则提醒，未认定诈骗、盗用或不当消费。请与本人沟通；管理人不能代替本人批准或操作资金。' });
      }
    }
    const security = this.security.status(userId);
    return {
      links,
      preferences: state.alertPreferences,
      alerts: alerts.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100),
      ownAlerts: state.riskEvents
        .filter(e => e.riskLevel !== 'normal')
        .slice(-30)
        .reverse()
        .map(({ id, phase, at, riskLevel, reasonCodes, amountCents }) => ({ id, phase, at, riskLevel, reasonCodes, amountCents })),
      operationCodeConfigured: security.operationCodeConfigured,
      operationLockedUntil: security.operationLockedUntil,
      note: '站内提醒在页面打开时轮询更新；不会发送真实短信/微信，后台或关闭网页不保证送达。儿童仅合成档案，不做现实监护认证。',
    };
  }
}
