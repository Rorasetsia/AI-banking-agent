// Recovery offers navigation/editing only. It never grants authority or executes a tool.
const route = (label, target) => ({ label, kind: 'navigate', route: target });
const edit = { label: '修改请求', kind: 'edit' };
const refresh = { label: '刷新并核对状态', kind: 'refresh' };
export function describeRecovery(error, draft) {
  const code = typeof error === 'string' ? error : error?.code;
  let title = '请核对当前状态，再调整请求。', actions = [refresh, edit];
  if (['INSUFFICIENT_FUNDS','INVALID_AMOUNT','BUDGET_TOO_LOW'].includes(code)) {
    title = '本次未完成，请核对可用资金或修改金额。';
    actions = [route('查看可用资金', 'overview'), edit];
  } else if (['CARD_UNAVAILABLE','CARD_LOST','CARD_REQUIRED','LIMIT_EXCEEDED','LIMIT_RANGE'].includes(code)) {
    title = '请先检查卡片状态和限额，再重新核对计划。';
    actions = [route('查看卡片', 'cards'), edit];
  } else if (['RISK_REQUIRED','RISK_REASSESS_REQUIRED','RISK_EXPIRED','RISK_MISMATCH','PRODUCT_REQUIRED','INVALID_PURCHASE','HOLDING_LOCKED','INSUFFICIENT_SHARES'].includes(code)) {
    title = '请检查风险评估、产品条件或可赎回份额。';
    actions = [route('前往财富计划', 'wealth'), edit];
  } else if (['INVALID_DATE','EVENT_MONTH','INVALID_DAYS','SCHEDULE_NOT_FOUND','RESERVATION_MISSING'].includes(code)) {
    title = '请核对预约日期、预算和任务状态，修改后重新确认。';
    actions = [route('查看任务', 'tasks'), edit];
  } else if (['PLAN_EXPIRED','PLAN_NOT_PENDING','NONCE_MISMATCH','PLAN_NOT_FOUND'].includes(code)) {
    title = '请先核对原计划和凭证；已执行的操作不能通过重试重复创建。';
    actions = [refresh, route('查看任务与凭证', 'tasks'), edit];
  }
  return { title, actions, ...(typeof draft === 'string' ? { draft: draft.slice(0, 2000) } : {}) };
}
