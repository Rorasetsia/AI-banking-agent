import { randomUUID } from 'node:crypto';

const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }); };
const money = n => `¥${(n / 100).toFixed(2)}`;

export function ensureOwnFunds(state) {
  state.ownCards ??= [
    { id: 'own-card-0618', name: '本人他行借记卡', last4: '0618', ownerId: state.userId, balanceCents: 5000000, status: 'active', perTxLimitCents: 2000000 },
    { id: 'own-card-0926', name: '本人备用借记卡', last4: '0926', ownerId: state.userId, balanceCents: 1500000, status: 'active', perTxLimitCents: 1000000 },
  ];
  state.ownFundMovements ??= [];
  return state.ownCards;
}

export function normalizeOwnFunds(state, intent) {
  if (!['own_deposit', 'own_withdraw'].includes(intent.kind)) return null;
  ensureOwnFunds(state);
  const { amountCents, ownCardId } = intent.slots ?? {};
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > 9999999900) fail('INVALID_AMOUNT', '请输入大于0、最多两位小数的金额。');
  const card = state.ownCards.find(c => c.id === ownCardId);
  if (!card || card.ownerId !== state.userId) fail('OWN_CARD_REQUIRED', '请选择当前本人名下已绑定的合成借记卡；不能转到其他人的银行卡。');
  const main = state.cards.find(c => c.id === 'card-debit');
  if (card.status !== 'active' || main?.status !== 'active') fail('CARD_UNAVAILABLE', '本次互转涉及的借记卡已锁定或不可用。', 409);
  if (amountCents > Math.min(card.perTxLimitCents, main.perTxLimitCents)) fail('LIMIT_EXCEEDED', '本次金额超过参与卡片的单笔限额。', 409);
  const incoming = intent.kind === 'own_deposit';
  if (amountCents > (incoming ? card.balanceCents : state.account.balanceCents - state.account.reservedCents)) fail('INSUFFICIENT_FUNDS', incoming ? '本人来源银行卡的模拟余额不足。' : '当前账户可用资金不足，预留资金不能转出。', 409);
  const params = { amountCents, ownCardId: card.id, last4: card.last4, cardName: card.name, direction: incoming ? 'in' : 'out' };
  return {
    step: { tool: intent.kind, params, label: incoming ? `从本人卡尾号${card.last4}存入 ${money(amountCents)}` : `转出 ${money(amountCents)} 至本人卡尾号${card.last4}` },
    impactCents: incoming ? -amountCents : amountCents,
    warnings: ['仅本人合成账户内部互转；两边余额同时更新，不接真实银行和支付。', '本人账户互转不是工资、消费或投资收益；仍须逐笔交易核验。'],
  };
}

export function applyOwnFunds(state, step) {
  const validated = normalizeOwnFunds(state, { kind: step.tool, slots: step.params });
  if (!validated) return null;
  const { amountCents, ownCardId } = validated.step.params;
  const incoming = step.tool === 'own_deposit';
  const card = state.ownCards.find(c => c.id === ownCardId);
  const signed = incoming ? amountCents : -amountCents;
  const transactionId = `tx-${randomUUID()}`;
  card.balanceCents -= signed;
  state.account.balanceCents += signed;
  const movement = { id: `movement-${randomUUID()}`, transactionId, ownCardId, amountCents, direction: incoming ? 'in' : 'out', date: new Date(state.now).toISOString() };
  state.ownFundMovements.push(movement);
  state.transactions.push({ id: transactionId, amountCents: signed, merchant: `${card.name}（尾号${card.last4}）`, category: '本人互转', date: movement.date, memo: '本人合成账户内部互转；不是收入、消费或投资收益', kind: step.tool, movementId: movement.id });
  return [transactionId];
}
