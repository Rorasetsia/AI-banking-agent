import { createHash, randomUUID } from 'node:crypto';

const DEFAULT_NOW = '2026-10-18T09:00:00+08:00';
const pad = (n) => String(n).padStart(2, '0');
const clone = (value) => structuredClone(value);
export const PRODUCT_CATALOG = Object.freeze([
  { id: 'product-cash', name: '易方达易理财货币A', code: '000359', manager: '易方达基金管理有限公司', category: '货币市场基金', officialUrl: 'https://www.efunds.com.cn/fund/000359.shtml', riskLevel: 1, termDays: 0, minCents: 100, unitPriceCents: 100, description: '真实基金公开资料；本项目仅使用该资料做产品展示，申购、份额和资金结算均为独立沙箱模拟。风险适当性档位为演示设定。' },
  { id: 'product-bond', name: '易方达信用债债券A', code: '000032', manager: '易方达基金管理有限公司', category: '债券型基金', officialUrl: 'https://www.efunds.com.cn/fund/000032.shtml', riskLevel: 2, termDays: 0, minCents: 100, unitPriceCents: 100, description: '真实基金公开资料；本项目仅使用该资料做产品展示，申购、份额和资金结算均为独立沙箱模拟。风险适当性档位为演示设定。' },
  { id: 'product-growth', name: '易方达消费行业股票', code: '110022', manager: '易方达基金管理有限公司', category: '股票型基金', officialUrl: 'https://www.efunds.com.cn/Mobile/fund/110022.shtml', riskLevel: 4, termDays: 0, minCents: 100, unitPriceCents: 100, description: '真实基金公开资料；行业主题与持仓净值可能出现较大波动。本项目的申购、份额和资金结算均为独立沙箱模拟。风险适当性档位为演示设定。' }
]);
const iso = (year, month, day, hour = 9, minute = 0) =>
  `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+08:00`;

function readMonth(now) {
  const matched = /^(\d{4})-(\d{2})/.exec(now);
  if (matched) return { year: Number(matched[1]), month: Number(matched[2]) };
  const date = new Date(now);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function shiftMonth(year, month, delta) {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

const tx = (id, amountCents, merchant, category, date, memo, kind) => ({
  id, amountCents, merchant, category, date, memo, kind
});

export function createSeed(userId, now = DEFAULT_NOW) {
  const { year: baseYear, month: baseMonth } = readMonth(now);
  const transactions = [];
  const subscriptions = [
    { id: 'sub-video', name: '视频会员', amountCents: 2500, chargeDay: 3, nextDay: 25, category: '娱乐' },
    { id: 'sub-music', name: '音乐会员', amountCents: 1500, chargeDay: 6, nextDay: 22, category: '娱乐' },
    { id: 'sub-cloud', name: '云盘会员', amountCents: 900, chargeDay: 9, nextDay: 28, category: '娱乐' }
  ];

  for (let delta = -12; delta <= 0; delta += 1) {
    const { year, month } = shiftMonth(baseYear, baseMonth, delta);
    const key = `${year}${pad(month)}`;
    const index = delta + 12;
    transactions.push(
      tx(`tx-${key}-salary`, 800000, '星海科技有限公司', '收入', iso(year, month, 10), '月度工资', 'income'),
      tx(`tx-${key}-rent`, -520000, '张明', '居住', iso(year, month, 5, 10), '房租', 'transfer'),
      tx(`tx-${key}-dining`, -(8600 + (index % 4) * 200), '云味小馆', '餐饮', iso(year, month, 8, 12), '工作餐', 'expense'),
      tx(`tx-${key}-transport`, -(1600 + (index % 3) * 100), '城市地铁', '交通', iso(year, month, 12, 8), '通勤交通', 'expense'),
      tx(`tx-${key}-transfer`, -52000, '林悦', '转账', iso(year, month, 15, 20), '给爱人的生活费', 'transfer'),
      tx(`tx-${key}-shopping`, -(32800 + (index % 5) * 500), '盒马鲜生', '购物', iso(year, month, 16, 19), '日常采购', 'expense'),
      tx(`tx-${key}-fun`, -(12800 + (index % 2) * 600), '万达影城', '娱乐', iso(year, month, 17, 19), '电影与休闲', 'expense'),
      tx(`tx-${key}-wealth`, -100000, '易方达易理财货币A', '理财', iso(year, month, 15, 9, 30), '每月定投（演示样本）', 'wealth')
    );
    for (const item of subscriptions) {
      transactions.push(tx(
        `tx-${key}-${item.id}`, -item.amountCents, item.name, item.category,
        iso(year, month, item.chargeDay, 10), `${item.name}自动续费`, 'subscription'
      ));
    }
  }

  const currentKey = `${baseYear}${pad(baseMonth)}`;
  transactions.push(
    tx(`tx-${currentKey}-big`, -599900, '京东商城', '购物', iso(baseYear, baseMonth, 14, 20, 5), '大额购物：笔记本电脑', 'expense'),
    tx(`tx-${currentKey}-dup-1`, -39800, '山姆会员店', '购物', iso(baseYear, baseMonth, 17, 18, 12), '会员店消费', 'expense'),
    tx(`tx-${currentKey}-dup-2`, -39800, '山姆会员店', '购物', iso(baseYear, baseMonth, 17, 18, 14), '会员店消费（同一笔重复扣费）', 'expense')
  );
  transactions.sort((a, b) => a.date.localeCompare(b.date));

  const contacts = [
    { id: 'contact-linyue', name: '林悦', phone: '13800000001', note: '爱人' },
    { id: 'contact-chenchen-1', name: '陈晨', phone: '13900000002', note: '同事' },
    { id: 'contact-chenchen-2', name: '陈晨', phone: '13900000003', note: '大学同学' },
    { id: 'contact-zhangming', name: '张明', phone: '13700000004', note: '房东' },
    { id: 'contact-wangxiaomei', name: '王小美', phone: '13600000005', note: '同事' }
  ];

  const products = clone(PRODUCT_CATALOG);

  return {
    userId,
    profile: { name: '李然' },
    now,
    account: { id: 'acct-main', name: '沙箱活期账户', balanceCents: 2865042, reservedCents: 0, openingBalanceCents: 2865042-transactions.reduce((n,t)=>n+t.amountCents,0) },
    contacts,
    transactions,
    products,
    holdings: [{ productId: 'product-cash', shares: 12000 }],
    subscriptions: subscriptions.map((item) => ({
      id: item.id,
      name: item.name,
      amountCents: item.amountCents,
      cycleDays: 30,
      nextChargeAt: iso(baseYear, baseMonth, item.nextDay, 10),
      status: 'active',
      source: item.id === 'sub-cloud' ? 'detected' : 'authorized',
      category: item.category
    })),
    cards: [
      { id: 'card-debit', name: '沙箱借记卡', last4: '8821', type: 'debit', status: 'active', limitCents: 0, perTxLimitCents: 2000000 },
      { id: 'card-credit', name: '沙箱信用卡', last4: '6677', type: 'credit', status: 'active', limitCents: 3000000, perTxLimitCents: 1000000 }
    ],
    risk: null,
    plans: [],
    schedules: [],
    goals: [],
    audit: [],
    messages: [],
    pending: null
  };
}

export function appendAudit(state, action, detail) {
  if (!Array.isArray(state.audit)) state.audit = [];
  const prevHash = state.audit.length ? state.audit[state.audit.length - 1].hash : '';
  const entry = {
    id: `audit-${randomUUID()}`,
    at: new Date().toISOString(),
    action,
    detail: detail === undefined ? null : clone(detail),
    prevHash,
    hash: ''
  };
  entry.hash = createHash('sha256').update(JSON.stringify({
    id: entry.id,
    at: entry.at,
    action: entry.action,
    detail: entry.detail,
    prevHash: entry.prevHash
  })).digest('hex');
  state.audit.push(entry);
  return entry;
}
