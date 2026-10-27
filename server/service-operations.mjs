import {GREEN_SCOPE,runGreenWatches} from './green-finance.mjs';
import { randomUUID } from 'node:crypto';

/**
 * 有限委托 / 扣费证据 / 客服 独立业务模块（模拟环境演示）。
 * 约束：只读监测与本地草稿，不转账、不取消代扣、不申赎、不改卡片与资金。
 * 校验策略：缺省值显式补齐（30 天 / 30 天 / ¥3000.00）；
 * 用户明示的越界、非整数、不存在的排除对象一律拒绝并报错，
 * 不静默夹值、不替换默认值、不悄悄扩大监测范围。
 */

const HOUR = 3600000;
const DAY = 86400000;
const SCOPE_SUB = 'subscription_watch';
const SCOPE_BILL = 'bill_watch';
const SCOPES = [SCOPE_SUB, SCOPE_BILL];
const SCOPE_NAMES = { [SCOPE_SUB]: '订阅监测', [SCOPE_BILL]: '账单监测' };
const STATUS_NAMES = { active: '进行中', paused: '已暂停', revoked: '已撤销', expired: '已过期' };
const TOOLS = [
  'service_mandate_create',
  'service_mandate_pause',
  'service_mandate_resume',
  'service_mandate_revoke',
  'service_dispute_draft'
];
const MAX_ACTIVE = 20;
const MAX_NOTIFICATIONS = 200;
const MAX_RUNS = 20;
const DEFAULT_THRESHOLD_CENTS = 300000;
const DEFAULT_DURATION_DAYS = 30;
const DEFAULT_INTERVAL_DAYS = 30;
const MIN_DURATION_DAYS = 1;
const MAX_DURATION_DAYS = 90;
const MIN_INTERVAL_DAYS = 1;
const MAX_INTERVAL_DAYS = 30;
const MIN_THRESHOLD_CENTS = 100;
const MAX_THRESHOLD_CENTS = 100000000;
const FAQ_REF = '本项目服务说明 v0.4';

const invalid = (message, code = 'INVALID_MANDATE', status = 400) => Object.assign(new Error(message), { status, code });

const localDay = (value) => new Date(new Date(value).getTime() + 8 * HOUR).toISOString().slice(0, 10);
const yuan = (cents) => `¥${(Number(cents) / 100).toFixed(2)}`;
const toIso = (ms) => new Date(ms).toISOString();
const mandatesOf = (state) => (Array.isArray(state?.mandates) ? state.mandates : []);
const subscriptionsOf = (state) => (Array.isArray(state?.subscriptions) ? state.subscriptions : []);
const transactionsOf = (state) => (Array.isArray(state?.transactions) ? state.transactions : []);
const casesOf = (state) => (Array.isArray(state?.disputeCases) ? state.disputeCases : []);

const refNow = (state) => {
  const ref = Date.parse(state?.now);
  if (!Number.isFinite(ref)) throw Object.assign(new Error('缺少演示时钟 state.now'), { status: 500, code: 'MISSING_CLOCK' });
  return ref;
};

const defaultTitle = (scope) => (scope === SCOPE_BILL ? '账单只读监测' : '订阅只读监测');

const describeMandates = (list) => list
  .map((item) => `- ${item.title}（${SCOPE_NAMES[item.scope] ?? item.scope}，${STATUS_NAMES[item.status] ?? item.status}，到期 ${localDay(item.expiresAt)}，${item.id}）`)
  .join('\n');

export function ensureServices(state) {
  if (!state || typeof state !== 'object') throw new TypeError('state 必须是对象');
  for (const key of ['mandates', 'disputeCases', 'notifications']) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  return state;
}

function pushNotification(state, payload) {
  ensureServices(state);
  if (payload.dedupeKey && state.notifications.some((item) => item.dedupeKey === payload.dedupeKey)) return null;
  const entry = { read: false, ...payload, id: `ntf-${randomUUID()}` };
  state.notifications.push(entry);
  if (state.notifications.length > MAX_NOTIFICATIONS) {
    state.notifications.splice(0, state.notifications.length - MAX_NOTIFICATIONS);
  }
  return entry;
}

const snapshotBaseline = (state) => subscriptionsOf(state)
  .map((sub) => ({ id: sub.id, amountCents: sub.amountCents, status: sub.status }));

const THRESHOLD_UNITS = {
  万元: { mult: 1000000, frac: 4 },
  元: { mult: 100, frac: 2 },
  块: { mult: 100, frac: 2 },
  分: { mult: 1, frac: 0 }
};

function parseThreshold(text) {
  const matched = /(\d+)(?:\.(\d+))?\s*(万元|元|块|分(?!钟))/.exec(text);
  if (!matched) return {};
  const unit = THRESHOLD_UNITS[matched[3]];
  const fraction = matched[2] ?? '';
  if (fraction.length > unit.frac) {
    return {
      error: `提醒金额「${matched[0].trim()}」超出可精确到分的位数，我不会四舍五入，请给一个精确到分的金额（最多两位小数）。`
    };
  }
  const integer = Number(matched[1]);
  const centPart = fraction ? Number(fraction.padEnd(unit.frac, '0')) * (unit.mult / 10 ** unit.frac) : 0;
  const cents = integer * unit.mult + centPart;
  if (!Number.isSafeInteger(cents) || cents < MIN_THRESHOLD_CENTS || cents > MAX_THRESHOLD_CENTS) {
    return { error: `提醒金额需要在 ${yuan(MIN_THRESHOLD_CENTS)} 至 ${yuan(MAX_THRESHOLD_CENTS)} 之间，我不会自动替换成默认值。` };
  }
  return { cents };
}

function parseDuration(text) {
  const matched = /(?:有效期(?:限)?|期限|持续|为期|有效)\s*(?:为|是|等于|：|:)?\s*(\d+)\s*(个月|星期|天|日|周|月)/.exec(text);
  if (!matched) return {};
  const unit = matched[2];
  const per = unit === '周' || unit === '星期' ? 7 : unit === '月' || unit === '个月' ? 30 : 1;
  const days = Number(matched[1]) * per;
  if (!Number.isSafeInteger(days) || days < MIN_DURATION_DAYS || days > MAX_DURATION_DAYS) {
    return { error: `有效期 ${matched[1]}${unit}超出 ${MIN_DURATION_DAYS}–${MAX_DURATION_DAYS} 天的范围，我不会自动夹值，也没有创建委托。` };
  }
  return { days };
}

function parseInterval(text) {
  if (/每天|每日/.test(text)) return { days: 1 };
  if (/每周|每星期/.test(text)) return { days: 7 };
  const daily = /每\s*(\d+)\s*天/.exec(text);
  const weekly = daily ? null : /每\s*(\d+)\s*(?:周|星期)/.exec(text);
  const target = daily ?? weekly;
  if (target) {
    const per = daily ? 1 : 7;
    const days = Number(target[1]) * per;
    if (!Number.isSafeInteger(days) || days < MIN_INTERVAL_DAYS || days > MAX_INTERVAL_DAYS) {
      return { error: `检查频率「每 ${target[1]}${per === 1 ? '天' : '周'}」超出 ${MIN_INTERVAL_DAYS}–${MAX_INTERVAL_DAYS} 天的范围，我不会自动夹值，也没有创建委托。` };
    }
    return { days };
  }
  if (/每月|每个月/.test(text)) return { days: 30 };
  return {};
}

const EXCLUSION_STOP = /^(?:别的|别的都|其他|其它的?|其余|其余的都|无关|不重要|一切|所有|全部|其他都|其它都)/;

function extractExclusions(text, state) {
  const subs = subscriptionsOf(state);
  const ids = new Set();
  const segments = [];
  const pattern = /(?:排除|除了|别动|不要动|不用动|不用管|别管|不监测|不检查|不动|不包括|跳过)([^，。；;,.!?！？]{0,15})/g;
  let matched;
  while ((matched = pattern.exec(text))) {
    const segment = matched[1].trim();
    if (segment && !EXCLUSION_STOP.test(segment)) segments.push(segment);
  }
  for (const segment of segments) {
    for (const sub of subs) {
      const alias = sub.name.slice(0, 2);
      if (segment.includes(sub.id) || segment.includes(sub.name) || sub.name.includes(segment) || (alias.length >= 2 && segment.includes(alias))) {
        ids.add(sub.id);
      }
    }
  }
  for (const sub of subs) if (text.includes(sub.id)) ids.add(sub.id);
  return { ids: [...ids], hadClause: segments.length > 0, segments };
}

function shortReason(text) {
  const index = text.search(/[：:]/);
  const raw = index >= 0 ? text.slice(index + 1) : text;
  const cleaned = raw
    .replace(/tx-[A-Za-z0-9-]+/g, ' ')
    .replace(/(请|帮我|麻烦|生成|创建|发起|一份|一个|争议|草稿|申诉|投诉|流水|这笔|该笔|谢谢)/g, ' ')
    .replace(/^[，,。；;、\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 200);
}

const FAQ = [
  {id:'transaction-verification',match:/核验|验证|交易保护|交易安全|二次确认|双重确认/,body:'请先核对方案中的对象、金额、卡片和日期，再输入交易密码并完成已绑定设备验证。两项必须同时通过，无设备时阻断。已明确双因子授权的具体预约可在约定条件内到期执行；条件变化必须重新授权。请勿把密码输入聊天。'},
  {id:'fees',match:/手续费|费率|收费标准/,body:'本模拟环境不接实际银行收费系统，不能据此判断真实手续费、费率或退款期限。请核对银行或商户官方规则；本项目没有接入真人客服。'},
  {
    id: 'transfer-arrival',
    match: /到账|多久到账|转账多久|汇款多久|清算/,
    body: '模拟环境转账是模拟执行：提交后由演示引擎记账并写入流水，“到账”只代表演示账本里出现了该条记录，不代表真实银行清算，也不代表真实资金已划转。真实到账时间取决于银行与通道，本项目不提供该数据，也不编造承诺。'
  },
  {
    id: 'deposit-withdraw',
    match: /存入|转入|转出|充值|提现/,
    body: '本项目的可用资金与流水由本地模拟记账，不接入真实银行账户。存入/转出只改变演示账本余额与流水记录，不产生真实资金划转，也不涉及真实清算或手续费。'
  },
  {
    id: 'risk',
    match: /风险评估|风险测评|适当性|风险等级/,
    body: '风险评估由你本人在申购前完成，结果只用于筛选演示产品档位（依据演示设定的风险等级），不做自动推荐，也不会因为测评结果就自动下单。'
  },
  {
    id: 'credential',
    match: /密码|验证码|设备|登录|指纹|人脸|webauthn/i,
    body: '密码与 WebAuthn 必须由你本人操作。客服模块不会索取、回显或记录密码、验证码，也不支持在对话里改密码或绑定设备；相关操作请使用项目既有的安全设置页面，由你本人确认。'
  },
  {
    id: 'lock-card',
    match: /锁卡|挂失|冻结|丢卡|卡片丢/,
    body: '锁卡/挂失属于敏感操作，需要你在卡片页发起并由本人用密码 + WebAuthn 确认。本模块不会代为锁卡、挂失或解冻，也不会声称已经替你处理。'
  },
  {
    id: 'subscription-cancel',
    match: /订阅|代扣|自动续费|续费|退订|会员/,
    body: '订阅取消只能走既有的模拟环境取消授权流程：由你本人在页面上确认，取消后不再模拟扣费。只读委托只能提醒（例如涨价、到期前 3 天），不能替你取消代扣；含“自动取消/自动付款”的意愿不会被受理。'
  },
  {
    id: 'dispute-fraud',
    match: /诈骗|盗刷|被骗|追回|可疑/,
    body: '若怀疑盗刷或诈骗：先在卡片页锁卡，再核对流水。本项目不会真的联系商户、银行或警方，也不承诺退款或追回；争议草稿只保存在本地并标注 sandbox，需要你本人决定是否对外申诉。'
  },
  {
    id: 'privacy',
    match: /隐私|安全|数据|权限|泄露/,
    body: '本项目使用合成账户数据，本地保存账务和记录。启用DeepSeek理解业务时，你的当前消息和必要合成摘要会发送至模型服务；交易密码、设备验证凭据不会附加给模型。请勿在聊天里输入密码、验证码或真实敏感资料。家庭提醒仅在双方同意范围内分享，可随时撤销。'
  }
];

const FALLBACK_HINT = /客服|帮助|服务说明|安全|隐私|订阅|扣款|账单|转账|到账|卡片|密码|风险|委托|争议|诈骗/;

export function parseServiceText(text, state) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (!t) return null;
  const source = state ?? {};
  const answer = (body, extra = {}, trace = []) => ({
    reply: body,
    sources: { transactionIds: [], refs: [], ...extra },
    trace
  });
  if(/(?:人工|真人).{0,6}客服|客服.{0,6}(?:人工|真人)|(?:联系|转接|接通).{0,8}(?:客服|人工|银行|商户)/.test(t))return answer('本项目没有接入真人客服，不能代你联系银行或商户。可以先由小苔查询模拟环境业务、整理扣费证据或争议草稿；真实业务请从银行或商户官方渠道联系。',{refs:[`${FAQ_REF}#人工协助`]});

  const bypass = [
    /(?:帮我|给我|替我|请|直接|设置|开通|开启).{0,10}自动(?:扣费|扣款|转账|付款|支付|退款|取消|续费|购买|申购|赎回|下单|缴费)/,
    /(?:跳过|绕过|免掉|免除).{0,6}(?:密码|验证|授权|确认|双因子|人脸|风控)/,
    /(?:不用|无需|不需要|不必).{0,6}(?:我)?(?:确认|密码|验证|授权)/,
    /(?:后台|偷偷|悄悄|私下).{0,8}(?:扣|转|付|划走)/
  ];
  if (bypass.some((pattern) => pattern.test(t))) {
    return answer(
      '这类请求不会被受理：转账、订阅取消、申购赎回与敏感资料变更都必须由你本人逐笔确认（密码 + WebAuthn 双因子），本模块不会在后台自动付款、自动扣款或自动取消代扣。你已经用双因子逐笔确认过的具体预约，只会在原有的金额与条件下执行；金额、收款方、期限等条件一变，必须重新确认。只读监测委托只是提醒，不是付款授权，也不会替你在任何条件下扣款。',
      { refs: [`${FAQ_REF}#委托边界`] },
      [{ step: 'guard', allowed: false, reason: 'bypass_authorization' }]
    );
  }

  const action = /(?:帮我|给我|替我|麻烦|请)\s*(?:转账|汇款|打钱|付款|支付|购买|买|申购|赎回|卖出|退订|退款)|转账\s*\d|转给|打钱|汇款\s*\d/;
  if (action.test(t)) return null;
  const cancelAction = /(?:取消|关闭|退订|解约|终止|撤销).{0,8}(?:代扣|自动续费|自动扣款|订阅授权|授权|会员|订阅)/;
  if (cancelAction.test(t) && !/委托/.test(t) && !/怎么|如何|能不能|可以吗|是否|能否/.test(t)) return null;

  if (/争议|申诉|投诉/.test(t)) {
    const expenses = transactionsOf(source).filter((tx) => tx.amountCents < 0);
    const idMatch = /tx-[A-Za-z0-9-]+/.exec(t);
    if (idMatch) {
      const tx = expenses.find((row) => row.id === idMatch[0]);
      if (!tx) {
        return answer(
          `没有找到流水 ${idMatch[0]}，或者它不是支出流水。请从下面的支出流水里选一笔，再说一次对应的流水号。`,
          { transactionIds: expenses.slice(-5).map((row) => row.id) },
          [{ step: 'resolve_transaction', hit: false }]
        );
      }
      return { kind: 'service_dispute_draft', slots: { transactionId: tx.id, reason: shortReason(t) } };
    }
    const pending = new Set(casesOf(source).filter((row) => row.status === 'draft').map((row) => row.transactionId));
    const candidates = suspicionCandidates(source).filter((row) => !pending.has(row.id)).slice(0, 5);
    const list = candidates.length ? candidates : expenses.slice(-3).map((tx) => ({ id: tx.id, label: `${localDay(tx.date)} ${tx.merchant} ${yuan(-tx.amountCents)}` }));
    return answer(
      `生成争议草稿需要指定一笔支出流水，我不会替你默认选择。可选的流水：\n${list.map((row) => `- ${row.id}：${row.label}`).join('\n')}\n回复「为 <流水号> 生成争议草稿：原因」即可；草稿只在本地保存（sandbox），不提交给商户或银行，也不产生退款。`,
      { transactionIds: list.map((row) => row.id) },
      [{ step: 'need_transaction_id', candidates: list.length }]
    );
  }

  const mandateWord = /委托/.test(t) || /监测|监督/.test(t);
  const pause = /暂停/.test(t) && mandateWord;
  const resume = /恢复|继续监测|重新开启/.test(t) && mandateWord;
  const revoke = /撤销|终止|取消|停止/.test(t) && /委托/.test(t);
  if (pause || resume || revoke) {
    const op = revoke ? 'revoke' : resume ? 'resume' : 'pause';
    const targets = op === 'pause' ? ['active', 'paused'] : op === 'resume' ? ['paused'] : ['active', 'paused', 'expired'];
    const pool = mandatesOf(source).filter((item) => targets.includes(item.status));
    const idMatch = /mnd-[A-Za-z0-9-]+/.exec(t);
    let candidates = pool;
    if (idMatch) {
      candidates = pool.filter((item) => item.id.startsWith(idMatch[0]));
    } else {
      const scopeHint = /订阅|续费|会员/.test(t) ? SCOPE_SUB : /账单|流水|支出|消费/.test(t) ? SCOPE_BILL : null;
      if (scopeHint) candidates = pool.filter((item) => item.scope === scopeHint);
    }
    if (!candidates.length) {
      const all = mandatesOf(source);
      const label = op === 'pause' ? '进行中' : op === 'resume' ? '已暂停' : '可撤销';
      const verb = op === 'pause' ? '暂停' : op === 'resume' ? '恢复' : '撤销';
      return answer(
        `没有${label}状态的委托可以${verb}。${all.length ? `当前委托：\n${describeMandates(all)}` : '当前还没有任何只读委托。'}`,
        {},
        [{ step: 'resolve_mandate', op, hit: false }]
      );
    }
    if (candidates.length > 1) {
      return answer(
        `有多条委托符合条件，我不会替你默认选择，请带上编号再来一次：\n${describeMandates(candidates)}`,
        {},
        [{ step: 'resolve_mandate', op, hit: false, reason: 'ambiguous' }]
      );
    }
    const target = candidates[0];
    return { kind: `service_mandate_${op}`, slots: { mandateId: target.id, scope: target.scope } };
  }

  if (/委托/.test(t) && /查看|列出|有哪些|列表|管理|状态|详情/.test(t)) {
    const list = mandatesOf(source);
    if (!list.length) {
      return answer('当前还没有只读委托。像「每月检查订阅，涨价提醒我」这样的描述可以生成一条有限只读委托计划。', {}, [{ step: 'list_mandates', count: 0 }]);
    }
    return answer(
      `当前共 ${list.length} 条委托：\n${describeMandates(list)}\n委托只产生站内提醒（涨价、到期前 3 天、大额、疑似重复），不会转账、不会取消代扣。`,
      {},
      [{ step: 'list_mandates', count: list.length }]
    );
  }

  const review = /扣费异常|扣款异常|多扣|多收|重复扣款|重复扣费|重复扣钱|重复扣|盗刷|为什么.{0,8}(?:扣|少了|多了)|检查.{0,4}重复|帮我.{0,4}(?:看看|查|检查|核对).{0,8}(?:账单|流水|扣款|支出|消费)|这笔.{0,6}扣款|账单.{0,4}(?:不对|异常)|核对.{0,4}(?:账单|流水|扣款|支出)/;
  if (review.test(t)) return chargeReview(source);

  const wantsWatch = /监测|监督|盯着|盯|检查|跟踪|提醒|关注|委托/.test(t)
    && /订阅|续费|会员|账单|流水|扣款|支出|消费/.test(t);
  const planVerb = /创建|建立|设置|新建|做个|加个|来一个|帮我|给我|长期|持续|每\s*\d*\s*(?:天|日|周|星期|个?\s*月)/;
  if (wantsWatch && planVerb.test(t)) {
    const subScope = /订阅|续费|会员/.test(t);
    const billScope = /账单|流水|大额支出|重复扣款|大额消费|支出|消费/.test(t);
    const scope = subScope && !billScope ? SCOPE_SUB : billScope && !subScope ? SCOPE_BILL : null;
    if (!scope) {
      return answer('一次委托只能监测一种范围：请告诉我是「订阅监测」还是「账单监测」，我再生成只读委托计划。', {}, [{ step: 'need_scope' }]);
    }

    const threshold = parseThreshold(t);
    if (threshold.error) {
      return answer(`我没有创建委托：${threshold.error}`, { refs: [`${FAQ_REF}#委托边界`] }, [{ step: 'validate_threshold', ok: false }]);
    }
    const duration = parseDuration(t);
    if (duration.error) {
      return answer(`我没有创建委托：${duration.error}`, { refs: [`${FAQ_REF}#委托边界`] }, [{ step: 'validate_duration', ok: false }]);
    }
    const interval = parseInterval(t);
    if (interval.error) {
      return answer(`我没有创建委托：${interval.error}`, { refs: [`${FAQ_REF}#委托边界`] }, [{ step: 'validate_interval', ok: false }]);
    }
    const durationDays = duration.days ?? DEFAULT_DURATION_DAYS;
    const intervalDays = interval.days ?? DEFAULT_INTERVAL_DAYS;
    if (intervalDays > durationDays) {
      return answer(
        `我没有创建委托：检查频率（每 ${intervalDays} 天）不能大于有效期（${durationDays} 天）。可以缩短检查间隔，或延长有效期。`,
        { refs: [`${FAQ_REF}#委托边界`] },
        [{ step: 'validate_window', ok: false }]
      );
    }

    const { ids, hadClause, segments } = extractExclusions(t, source);
    if (hadClause && !ids.length) {
      const subs = subscriptionsOf(source);
      return answer(
        `我没有创建委托：没有找到要排除的订阅/对象，我不会忽略它去监测全部。现有订阅：${subs.map((sub) => `${sub.name}（${sub.id}）`).join('、') || '暂无'}。请说明要排除的名称或编号。`,
        {},
        [{ step: 'resolve_exclusion', hit: false, segments: segments.length }]
      );
    }

    return {
      kind: 'service_mandate_create',
      slots: {
        scope,
        title: defaultTitle(scope),
        thresholdCents: threshold.cents ?? DEFAULT_THRESHOLD_CENTS,
        excludedSubscriptionIds: ids,
        durationDays,
        intervalDays
      }
    };
  }

  for (const entry of FAQ) {
    if (entry.match.test(t)) {
      return answer(entry.body, { refs: [`${FAQ_REF}#${entry.id}`] }, [{ step: 'faq_match', id: entry.id }]);
    }
  }

  if (FALLBACK_HINT.test(t)) {
    return answer(
      '这个问题超出本项目服务说明 v0.4 的受控范围，我不会编造真实银行政策、费率或退款时限。本项目没有接入真人客服，我无法代为联系任何人，也不会声称已经联系；需要人工协助时，请通过你所用银行或商户的官方渠道联系，或把问题记录在本地备注里自行跟进。',
      { refs: [`${FAQ_REF}#overview`] },
      [{ step: 'faq_miss' }]
    );
  }
  return null;
}

export function normalizeServiceStep(state, intent) {
  if (!intent || typeof intent !== 'object' || !TOOLS.includes(intent.kind)) return null;
  const slots = intent.slots ?? {};
  const ref = refNow(state);
  const subs = subscriptionsOf(state);

  if (intent.kind === 'service_mandate_create') {
    if (!SCOPES.includes(slots.scope)) {
      throw invalid('委托监测范围只能是「订阅监测」或「账单监测」，否则不会落库。');
    }
    const scope = slots.scope;
    const warnings = [];

    let durationDays = DEFAULT_DURATION_DAYS;
    if (slots.durationDays !== undefined && slots.durationDays !== null) {
      if (!Number.isInteger(slots.durationDays) || slots.durationDays < MIN_DURATION_DAYS || slots.durationDays > MAX_DURATION_DAYS) {
        throw invalid(`有效期必须是 ${MIN_DURATION_DAYS}–${MAX_DURATION_DAYS} 之间的整数天，收到 ${String(slots.durationDays)}；我不会自动夹值或替换成默认值。`);
      }
      durationDays = slots.durationDays;
    }

    let intervalDays = DEFAULT_INTERVAL_DAYS;
    if (slots.intervalDays !== undefined && slots.intervalDays !== null) {
      if (!Number.isInteger(slots.intervalDays) || slots.intervalDays < MIN_INTERVAL_DAYS || slots.intervalDays > MAX_INTERVAL_DAYS) {
        throw invalid(`检查频率必须是 ${MIN_INTERVAL_DAYS}–${MAX_INTERVAL_DAYS} 之间的整数天，收到 ${String(slots.intervalDays)}；我不会自动夹值或替换成默认值。`);
      }
      intervalDays = slots.intervalDays;
    }
    if (intervalDays > durationDays) {
      throw invalid(`检查频率（每 ${intervalDays} 天）不能大于有效期（${durationDays} 天），请调整后再创建。`);
    }

    let thresholdCents = DEFAULT_THRESHOLD_CENTS;
    if (slots.thresholdCents !== undefined && slots.thresholdCents !== null) {
      if (!Number.isInteger(slots.thresholdCents) || slots.thresholdCents < MIN_THRESHOLD_CENTS || slots.thresholdCents > MAX_THRESHOLD_CENTS) {
        throw invalid(`提醒阈值必须是 ${MIN_THRESHOLD_CENTS}–${MAX_THRESHOLD_CENTS} 之间的整数分，收到 ${String(slots.thresholdCents)}；我不会自动夹值或替换成默认值。`);
      }
      thresholdCents = slots.thresholdCents;
    }

    let excludedSubscriptionIds = [];
    if (slots.excludedSubscriptionIds !== undefined && slots.excludedSubscriptionIds !== null) {
      if (!Array.isArray(slots.excludedSubscriptionIds)) {
        throw invalid('排除对象必须是订阅编号列表。');
      }
      const unknown = slots.excludedSubscriptionIds.filter((id) => typeof id !== 'string' || !subs.some((sub) => sub.id === id));
      if (unknown.length) {
        throw invalid(`没有找到要排除的订阅 ${unknown.map((id) => String(id)).join('、')}，我不会忽略它并扩大监测范围。`, 'INVALID_EXCLUSION');
      }
      excludedSubscriptionIds = [...new Set(slots.excludedSubscriptionIds)];
    }

    const title = typeof slots.title === 'string' && slots.title.trim() ? slots.title.trim().slice(0, 40) : defaultTitle(scope);
    const activeCount = mandatesOf(state).filter((item) => item.status === 'active').length;
    if (activeCount >= MAX_ACTIVE) warnings.push(`活动委托已达 ${MAX_ACTIVE} 条上限，需先撤销或等待到期。`);
    const names = excludedSubscriptionIds.map((id) => subs.find((sub) => sub.id === id)?.name).filter(Boolean);
    const label = `只读${SCOPE_NAMES[scope]}委托「${title}」：金额阈值 ${yuan(thresholdCents)}，有效期 ${durationDays} 天（至 ${localDay(toIso(ref + durationDays * DAY))}），每 ${intervalDays} 天检查一次${names.length ? `，排除 ${names.join('、')}` : ''}。仅写站内提醒，不转账、不取消代扣、不申赎。`;
    return {
      step: { tool: intent.kind, params: { scope, title, thresholdCents, excludedSubscriptionIds, durationDays, intervalDays }, label },
      impactCents: 0,
      warnings
    };
  }

  if (intent.kind === 'service_dispute_draft') {
    const transactionId = typeof slots.transactionId === 'string' ? slots.transactionId : '';
    const tx = transactionsOf(state).find((row) => row.id === transactionId);
    if (!tx) throw invalid('未找到该笔流水，无法生成争议草稿。', 'INVALID_TRANSACTION');
    if (!(tx.amountCents < 0)) throw invalid('只有支出流水可以生成争议草稿。', 'INVALID_TRANSACTION');
    const reason = typeof slots.reason === 'string' && slots.reason.trim() ? slots.reason.trim().slice(0, 200) : '对这笔扣款存在疑问，待核对。';
    const duplicated = casesOf(state).some((row) => row.transactionId === tx.id && row.status === 'draft');
    return {
      step: {
        tool: intent.kind,
        params: { transactionId: tx.id, reason },
        label: `争议草稿（本地，未提交）｜${localDay(tx.date)} ${tx.merchant} ${yuan(-tx.amountCents)}：${reason}`
      },
      impactCents: 0,
      warnings: duplicated ? ['该流水已有待处理争议草稿，不会重复创建。'] : []
    };
  }

  const mandateId = typeof slots.mandateId === 'string' ? slots.mandateId : '';
  const mandate = mandatesOf(state).find((item) => item.id === mandateId);
  if (!mandate) throw invalid('没有找到这条委托，可能已撤销或从未创建。', 'MANDATE_NOT_FOUND', 404);
  const currentStatus = STATUS_NAMES[mandate.status] ?? mandate.status;

  if (intent.kind === 'service_mandate_pause') {
    if (mandate.status !== 'active') {
      throw invalid(`委托当前状态为「${currentStatus}」，不能暂停；重复暂停不会被当作成功。`, 'MANDATE_NOT_ACTIVE', 409);
    }
    return {
      step: { tool: intent.kind, params: { mandateId: mandate.id }, label: `暂停只读委托「${mandate.title}」：暂停后不再产生提醒，未过期前可恢复。` },
      impactCents: 0,
      warnings: []
    };
  }

  if (intent.kind === 'service_mandate_resume') {
    if (mandate.status !== 'paused') {
      throw invalid(`委托当前状态为「${currentStatus}」，只有已暂停的委托可以恢复。`, 'MANDATE_NOT_PAUSED', 409);
    }
    const expiresAt = Date.parse(mandate.expiresAt);
    if (!Number.isFinite(expiresAt)) {
      throw invalid('委托缺少有效的到期时间，不能恢复，请重新创建。', 'MANDATE_STATE_INVALID', 409);
    }
    if (ref >= expiresAt) {
      throw invalid('委托已过期，不能恢复，请重新创建。', 'MANDATE_EXPIRED', 409);
    }
    if (slots.scope !== undefined && slots.scope !== mandate.scope) {
      throw invalid('恢复委托时不能更改监测范围，请新建委托。', 'MANDATE_SCOPE_CHANGE', 409);
    }
    return {
      step: { tool: intent.kind, params: { mandateId: mandate.id, scope: mandate.scope }, label: `恢复只读委托「${mandate.title}」（${SCOPE_NAMES[mandate.scope] ?? mandate.scope}，原范围不变）。` },
      impactCents: 0,
      warnings: []
    };
  }

  if (intent.kind === 'service_mandate_revoke') {
    if (mandate.status === 'revoked') {
      throw invalid('委托已经撤销，无需重复操作。', 'MANDATE_NOT_REVOCABLE', 409);
    }
    return {
      step: { tool: intent.kind, params: { mandateId: mandate.id }, label: `撤销只读委托「${mandate.title}」：撤销后不可恢复，不影响已有订阅与卡片。` },
      impactCents: 0,
      warnings: []
    };
  }

  throw invalid('不支持的委托操作。');
}

export function applyServiceStep(state, step) {
  if (!step || typeof step !== 'object' || !TOOLS.includes(step.tool)) return null;
  ensureServices(state);
  const intent = { kind: step.tool, slots: { ...(step.params ?? {}) } };
  const normalized = normalizeServiceStep(state, intent);
  if (!normalized) return [];
  const { tool, params } = normalized.step;
  const ref = refNow(state);

  if (tool === 'service_mandate_create') {
    if (state.mandates.filter((item) => item.status === 'active').length >= MAX_ACTIVE) {
      throw invalid(`活动委托已达 ${MAX_ACTIVE} 条上限，请先撤销或等待到期。`, 'MANDATE_LIMIT', 409);
    }
    state.mandates.push({
      id: `mnd-${randomUUID()}`,
      status: 'active',
      scope: params.scope,
      title: params.title,
      thresholdCents: params.thresholdCents,
      excludedSubscriptionIds: [...params.excludedSubscriptionIds],
      durationDays: params.durationDays,
      intervalDays: params.intervalDays,
      createdAt: toIso(ref),
      expiresAt: toIso(ref + params.durationDays * DAY),
      nextRunAt: toIso(ref),
      lastRunAt: null,
      baseline: snapshotBaseline(state),
      runs: []
    });
    return [];
  }

  if (tool === 'service_dispute_draft') {
    const tx = transactionsOf(state).find((row) => row.id === params.transactionId);
    if (!tx) return [];
    if (state.disputeCases.some((row) => row.transactionId === tx.id && row.status === 'draft')) return [];
    const related = findDuplicates(state, tx).map((row) => row.id);
    state.disputeCases.push({
      id: `case-${randomUUID()}`,
      transactionId: tx.id,
      status: 'draft',
      submission: 'notSubmitted',
      environment: 'sandbox',
      createdAt: toIso(ref),
      transaction: { id: tx.id, date: tx.date, merchant: tx.merchant, category: tx.category, amountCents: tx.amountCents, memo: tx.memo ?? null },
      relatedTransactionIds: related,
      userStatement: params.reason,
      facts: [
        `流水日期 ${localDay(tx.date)}，商户 ${tx.merchant}，金额 ${yuan(-tx.amountCents)}，分类 ${tx.category}。`,
        related.length
          ? `同日同商户同金额的其他流水：${related.join('、')}。可能是重复扣费，也可能是分单支付，需要核对。`
          : '未发现同日同商户同金额的其他流水。'
      ],
      openQuestions: [
        '是商户重复扣费，还是分单支付/正常补扣',
        '是否需要你本人联系商户或发卡行核实',
        '是否需要在卡片页锁卡或走既有的取消授权模拟环境流程'
      ],
      disclaimer: '本地草稿，未提交给商户、银行或监管机构；不承诺退款，不改变任何资金或卡片状态。'
    });
    return [];
  }

  const mandate = mandatesOf(state).find((item) => item.id === params.mandateId);
  if (!mandate) throw invalid('没有找到这条委托，操作未执行。', 'MANDATE_NOT_FOUND', 404);

  if (tool === 'service_mandate_pause') {
    if (mandate.status !== 'active') {
      throw invalid(`委托当前状态为「${STATUS_NAMES[mandate.status] ?? mandate.status}」，暂停未执行。`, 'MANDATE_NOT_ACTIVE', 409);
    }
    mandate.status = 'paused';
    mandate.pausedAt = toIso(ref);
    return [];
  }

  if (tool === 'service_mandate_resume') {
    if (mandate.status !== 'paused') {
      throw invalid(`委托当前状态为「${STATUS_NAMES[mandate.status] ?? mandate.status}」，恢复未执行。`, 'MANDATE_NOT_PAUSED', 409);
    }
    const expiresAt = Date.parse(mandate.expiresAt);
    if (!Number.isFinite(expiresAt) || ref >= expiresAt) {
      throw invalid('委托已过期，不能恢复，请重新创建。', 'MANDATE_EXPIRED', 409);
    }
    if (params.scope && params.scope !== mandate.scope) {
      throw invalid('恢复委托时不能更改监测范围，请新建委托。', 'MANDATE_SCOPE_CHANGE', 409);
    }
    mandate.status = 'active';
    mandate.resumedAt = toIso(ref);
    if (!Number.isFinite(Date.parse(mandate.nextRunAt)) || Date.parse(mandate.nextRunAt) < ref) mandate.nextRunAt = toIso(ref);
    return [];
  }

  if (tool === 'service_mandate_revoke') {
    if (mandate.status === 'revoked') {
      throw invalid('委托已经撤销，无需重复操作。', 'MANDATE_NOT_REVOCABLE', 409);
    }
    mandate.status = 'revoked';
    mandate.revokedAt = toIso(ref);
    return [];
  }

  throw invalid('不支持的委托操作。');
}

function scanSubscriptions(state, mandate, ref) {
  const excluded = new Set(mandate.excludedSubscriptionIds ?? []);
  const subs = subscriptionsOf(state).filter((sub) => sub.status === 'active' && !excluded.has(sub.id));
  const findings = [];
  for (const sub of subs) {
    const base = (mandate.baseline ?? []).find((row) => row.id === sub.id);
    if (base && Number.isFinite(base.amountCents) && Number.isFinite(sub.amountCents) && sub.amountCents > base.amountCents) {
      const diff = sub.amountCents - base.amountCents;
      findings.push({
        kind: 'subscription_price_up',
        refId: sub.id,
        title: `「${sub.name}」订阅金额上调`,
        body: `检测到「${sub.name}」金额由 ${yuan(base.amountCents)} 变为 ${yuan(sub.amountCents)}（+${yuan(diff)}）。这是待核对线索，不等于商户已多扣，请以你的订阅协议为准。`,
        dedupeKey: `${mandate.id}|sub_up|${sub.id}|${sub.amountCents}`
      });
    }
    const due = Date.parse(sub.nextChargeAt);
    if (Number.isFinite(due) && due >= ref - DAY && due <= ref + 3 * DAY) {
      findings.push({
        kind: 'subscription_due',
        refId: sub.id,
        title: `「${sub.name}」3 天内将扣费`,
        body: `预计 ${localDay(toIso(due))} 扣费 ${yuan(sub.amountCents)}。这里只做提醒，不会替你取消或付款。`,
        dedupeKey: `${mandate.id}|sub_due|${sub.id}|${localDay(toIso(due))}`
      });
    }
  }
  const note = subs.length
    ? `只读检查覆盖 ${subs.length} 个活动订阅${excluded.size ? `（已排除 ${excluded.size} 个）` : ''}，${findings.length ? `发现 ${findings.length} 条待核对线索。` : '未发现涨价或 3 天内扣费。'}`
    : '没有需要监测的活动订阅，本次未产生线索。';
  return { findings, checked: subs.length, note };
}

function scanBills(state, mandate, ref) {
  const excludedIds = new Set(mandate.excludedSubscriptionIds ?? []);
  const excludedNames = new Set(subscriptionsOf(state).filter((sub) => excludedIds.has(sub.id)).map((sub) => sub.name));
  const anchor = mandate.lastRunAt ? Date.parse(mandate.lastRunAt) : Date.parse(mandate.createdAt) - 30 * DAY;
  const since = Number.isFinite(anchor) ? anchor : ref - 30 * DAY;
  const rows = transactionsOf(state).filter((tx) => {
    const at = Date.parse(tx.date);
    return tx.amountCents < 0
      && Number.isFinite(at) && at > since && at <= ref
      && !excludedIds.has(tx.subscriptionId)
      && !excludedNames.has(tx.merchant);
  });
  const thresholdCents = Number.isSafeInteger(mandate.thresholdCents) && mandate.thresholdCents > 0
    ? mandate.thresholdCents
    : DEFAULT_THRESHOLD_CENTS;
  const findings = [];
  for (const tx of rows) {
    if (-tx.amountCents >= thresholdCents) {
      findings.push({
        kind: 'bill_large',
        refId: tx.id,
        title: '大额支出待核对',
        body: `${localDay(tx.date)} ${tx.merchant} ${yuan(-tx.amountCents)}（流水 ${tx.id}）超过你设定的 ${yuan(thresholdCents)} 提醒阈值。仅提醒，不冻结、不扣款。`,
        dedupeKey: `${mandate.id}|bill_large|${tx.id}`
      });
    }
  }
  const groups = new Map();
  for (const tx of rows) {
    const key = `${tx.merchant}|${tx.amountCents}|${localDay(tx.date)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tx);
  }
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const ids = list.map((row) => row.id);
    findings.push({
      kind: 'bill_duplicate',
      refId: ids[0],
      title: '同日同商户同金额重复',
      body: `${list[0].merchant} 在 ${localDay(list[0].date)} 出现 ${list.length} 笔 ${yuan(-list[0].amountCents)}（${ids.join('、')}）。可能是重复扣费，也可能是分单支付，请自行核对。`,
      dedupeKey: `${mandate.id}|bill_dup|${key}`
    });
  }
  const note = rows.length
    ? `只读检查覆盖 ${rows.length} 笔支出流水（${localDay(toIso(since))} 至 ${localDay(toIso(ref))}）${excludedNames.size ? `，已排除 ${[...excludedNames].join('、')}` : ''}，${findings.length ? `发现 ${findings.length} 条待核对线索。` : `未匹配到超过 ${yuan(thresholdCents)} 的大额支出或同日同商户同金额重复。`}`
    : '本次检查区间内没有可核对的支出流水，未产生线索。';
  return { findings, checked: rows.length, note };
}

export function runMandates(state, { force = false } = {}) {
  ensureServices(state);
  const ref = refNow(state);
  const runs = [];
  let notificationsCreated = 0;
  for (const mandate of state.mandates) {
    if(mandate.scope===GREEN_SCOPE)continue;
    if (mandate.status === 'active' || mandate.status === 'paused') {
      const expiresAt = Date.parse(mandate.expiresAt);
      if (Number.isFinite(expiresAt) && ref >= expiresAt) mandate.status = 'expired';
    }
    if (mandate.status !== 'active') continue;
    const dueAt = Date.parse(mandate.nextRunAt);
    if (!force && Number.isFinite(dueAt) && ref < dueAt) continue;
    const scan = mandate.scope === SCOPE_BILL ? scanBills(state, mandate, ref) : scanSubscriptions(state, mandate, ref);
    for (const finding of scan.findings) {
      const created = pushNotification(state, {
        mandateId: mandate.id,
        at: toIso(ref),
        kind: finding.kind,
        title: finding.title,
        body: finding.body,
        refId: finding.refId ?? null,
        dedupeKey: finding.dedupeKey
      });
      if (created) notificationsCreated += 1;
    }
    const nextRunAt = toIso(ref + Math.max(1, mandate.intervalDays ?? DEFAULT_INTERVAL_DAYS) * DAY);
    mandate.lastRunAt = toIso(ref);
    mandate.nextRunAt = nextRunAt;
    mandate.runs.push({ at: toIso(ref), scope: mandate.scope, checked: scan.checked, findings: scan.findings.length, note: scan.note, nextRunAt });
    if (mandate.runs.length > MAX_RUNS) mandate.runs.splice(0, mandate.runs.length - MAX_RUNS);
    runs.push({ mandateId: mandate.id, at: toIso(ref), findings: scan.findings.length, note: scan.note });
  }
  const green=runGreenWatches(state,{force});
  return { runs:[...runs,...green.runs], notificationsCreated:notificationsCreated+green.notificationsCreated };
}

function findDuplicates(state, tx) {
  return transactionsOf(state).filter((row) => row.id !== tx.id
    && row.amountCents === tx.amountCents
    && row.merchant === tx.merchant
    && localDay(row.date) === localDay(tx.date));
}

function suspicionCandidates(state) {
  const expenses = transactionsOf(state).filter((tx) => tx.amountCents < 0);
  const out = [];
  for (const tx of expenses) {
    if (findDuplicates(state, tx).length) {
      out.push({ id: tx.id, label: `${localDay(tx.date)} ${tx.merchant} ${yuan(-tx.amountCents)}（疑似重复）` });
    }
  }
  for (const tx of expenses) {
    if (-tx.amountCents >= DEFAULT_THRESHOLD_CENTS && !out.some((row) => row.id === tx.id)) {
      out.push({ id: tx.id, label: `${localDay(tx.date)} ${tx.merchant} ${yuan(-tx.amountCents)}（大额）` });
    }
  }
  return out;
}

export function chargeReview(state) {
  const expenses = transactionsOf(state).filter((tx) => tx.amountCents < 0);
  if (!expenses.length) {
    return {
      reply: '当前演示账本里没有支出流水，暂时无法核对扣费。等账单页出现新流水后再问我。',
      sources: { transactionIds: [] },
      trace: [{ step: 'scan_own_transactions', count: 0 }]
    };
  }
  const ids = new Set();
  const facts = [];
  const groups = new Map();
  for (const tx of expenses) {
    const key = `${tx.merchant}|${tx.amountCents}|${localDay(tx.date)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tx);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.forEach((tx) => ids.add(tx.id));
    facts.push(`同日同商户同金额出现 ${list.length} 笔 ${yuan(-list[0].amountCents)}：${list.map((tx) => `${tx.id}（${tx.merchant} ${localDay(tx.date)}）`).join('、')}。`);
    if (facts.length >= 8) break;
  }
  const large = expenses.filter((tx) => -tx.amountCents >= DEFAULT_THRESHOLD_CENTS).sort((a, b) => a.amountCents - b.amountCents);
  for (const tx of large.slice(0, 3)) {
    ids.add(tx.id);
    facts.push(`大额支出 ${yuan(-tx.amountCents)}：${localDay(tx.date)} ${tx.merchant}（${tx.memo || '无备注'}），流水 ${tx.id}。`);
  }
  if (large.length > 3) {
    large.slice(3).forEach((tx) => ids.add(tx.id));
    facts.push(`另有 ${large.length - 3} 笔达到 ${yuan(DEFAULT_THRESHOLD_CENTS)} 的大额支出未逐条展开。`);
  }
  const subs = new Map();
  for (const tx of expenses.filter((row) => row.kind === 'subscription' || /自动续费|订阅|代扣/.test(row.memo ?? ''))) {
    if (!subs.has(tx.merchant)) subs.set(tx.merchant, []);
    subs.get(tx.merchant).push(tx);
  }
  let changes = 0;
  for (const [merchant, list] of subs) {
    list.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const last = list[list.length - 1];
    const prev = list[list.length - 2];
    if (!prev || prev.amountCents === last.amountCents || changes >= 3) continue;
    changes += 1;
    ids.add(prev.id);
    ids.add(last.id);
    facts.push(`「${merchant}」扣费金额变化：${localDay(prev.date)} ${yuan(-prev.amountCents)} → ${localDay(last.date)} ${yuan(-last.amountCents)}（${last.id}）。`);
  }
  const guesses = [
    '同日同商户同金额也可能是分单支付或商户正常补扣，仅凭流水不能认定重复扣费。',
    `单笔超过 ${yuan(DEFAULT_THRESHOLD_CENTS)} 也可能就是你自己下的订单，目前没有商户订单信息，无法确认原因。`,
    '只有当你确认这些流水都不是本人操作时，才需要怀疑卡片信息被他人使用；这属于推测，需向商户或发卡行核实。'
  ];
  const factLines = facts.length ? facts.map((line) => `- ${line}`).join('\n') : `- 未匹配到同日同商户同金额重复、达到 ${yuan(DEFAULT_THRESHOLD_CENTS)} 的大额支出或订阅金额变化。`;
  return {
    reply: `已只读核对你的流水（共 ${expenses.length} 笔支出，来源仅限当前演示账本）。\n\n【事实】\n${factLines}\n\n【推测（未证实）】\n${guesses.map((line) => `- ${line}`).join('\n')}\n\n【下一步】\n- 回复「为 <流水号> 生成争议草稿」可在本地生成草稿，草稿不会提交给商户或银行，也不产生退款。\n- 想停止某笔订阅扣费，请走既有的取消授权模拟环境流程，由你本人用密码 + WebAuthn 确认。\n- 怀疑盗刷请先在卡片页锁卡（需你本人操作）。`,
    sources: { transactionIds: [...ids] },
    trace: [
      { step: 'scan_own_transactions', count: expenses.length },
      { step: 'rules', rules: ['duplicate_same_day_merchant_amount', 'large_amount', 'subscription_amount_change'] },
      { step: 'policy', note: '只读；不退款、不取消代扣、不改资金与卡片' }
    ]
  };
}
