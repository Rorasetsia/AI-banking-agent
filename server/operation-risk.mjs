const amountOf = step => {
  const p = step.params ?? {};
  return Math.max(0, ...['amountCents', 'budgetCents', 'totalCents', 'limitCents'].map(k => Number.isSafeInteger(p[k]) ? p[k] : 0));
};

export function assessOperationRisk(state, plan) {
  const reasons = [];
  const steps = plan.steps ?? [];
  const outflowTools=new Set(['transfer','own_withdraw','wealth_buy','budget_reserve','event_plan']);
  const combined=steps.filter(s=>outflowTools.has(s.tool)).reduce((sum,s)=>sum+amountOf(s),0);
  const maxAmount = Math.max(combined,0,...steps.map(amountOf));
  const sourceText = typeof plan.requestText === 'string' ? plan.requestText : '';
  const threshold = state.alertPreferences?.largeAmountCents ?? 300000;
  if (maxAmount >= threshold) reasons.push({ code: 'LARGE_AMOUNT', title: '达到大额核查线', detail: '本次金额达到你设置的大额提醒线，请核对用途与对象。' });
  if (steps.some(s => ['card_loss', 'card_unlock', 'card_limit'].includes(s.tool))) reasons.push({ code: 'CARD_POLICY', title: '敏感用卡操作', detail: '挂失、恢复交易或调整限额可能影响后续交易，请确认本人意愿。' });
  if (/安全账户|刷流水|刷单返利|保证金解冻|屏幕共享|远程控制|保密转账|验证码给/.test(sourceText)) reasons.push({ code: 'SCAM_CUE', title: '出现需要核查的风险线索', detail: '请求含常见风险措辞，不代表已认定诈骗；请停止共享屏幕，不向他人透露密码或验证码，先独立核实。' });
  const now = Date.parse(state.now);
  const recent = state.transactions.filter(t => t.amountCents < 0 && now - Date.parse(t.date) >= 0 && now - Date.parse(t.date) <= 600000);
  if (recent.length >= 3 && steps.some(s => amountOf(s) > 0)) reasons.push({ code: 'RAPID_PAYMENTS', title: '短时间多笔支出', detail: '演示时间10分钟内已有多笔支出，请核对是否重复或受人诱导。' });
  if (steps.length > 1) reasons.push({ code: 'COMPOSITE', title: '包含多项操作', detail: '请逐项核对，授权绑定本计划全部内容。' });
  const high = reasons.some(r => ['LARGE_AMOUNT', 'SCAM_CUE', 'RAPID_PAYMENTS'].includes(r.code));
  return { level: high ? 'high' : reasons.length ? 'medium' : 'normal', reasons, maxAmountCents: maxAmount, thresholdCents: threshold, checkedAt: new Date().toISOString(), note: '规则风险提示，不是诈骗认定；未命中规则也不代表交易绝对安全。' };
}
