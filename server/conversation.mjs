import { appendAudit } from './store.mjs';
import { unsafe, extractAmount, dateFor, parseAmount, parseRules } from './rules.mjs';

const correcting = text => /^(?:不对[，,\s]*|改成|改为|修改|换成)/.test(text);
const stopping = text => /^(?:取消|算了|不用了|停止|取消本次)(?:吧|了)?[。！!]?$/u.test(text);
const reply = (question, candidates = []) => ({reply:question, clarification:{question,candidates}, trace:['未执行资金操作']});

// The HTTP layer commits this before awaiting an LLM response. A failed rebuild
// must never roll back cancellation of the previous authorization.
export function prepareTurn(state, rawText = '') {
  const text = String(rawText).trim();
  if (!text || unsafe(text) || (!correcting(text) && !stopping(text))) return null;
  if (state.pending?.preparedText === text) return null;
  const plans = state.plans.filter(p => p.status === 'pending');
  if (plans.length > 1) return reply('有多个待确认计划，请到“预约与凭证”打开要修改或取消的计划。为避免选错，本次没有取消任何计划。');
  if (plans.length === 1) {
    const plan = plans[0];
    if (!stopping(text) && !plan.requestIntent) return reply('这个旧版计划缺少可恢复的请求，请先在“预约与凭证”取消，再完整描述新的业务。');
    plan.status = 'cancelled';
    appendAudit(state, 'plan_cancelled', {planId:plan.id, reason:stopping(text)?'user_stopped':'user_revised'});
    state.pending = stopping(text) ? null : {
      intent:structuredClone(plan.requestIntent), question:'原计划已取消，请核对修改后的新计划。',
      missing:[], candidates:[], expiresAt:Date.now()+600000, revisionOf:plan.id, preparedText:text,
    };
  }
  if (stopping(text)) {
    state.pending = null;
    return {reply:plans.length?'已取消本次待确认计划，没有扣款。':'已停止本次追问，没有执行业务。',trace:['清除追问；未执行资金操作']};
  }
  return null;
}

function select(text, rows) {
  const phone = /1[3-9]\d{9}/.exec(text)?.[0];
  const tail = /(?:尾号|手机尾号|末四位|卡号)\s*(\d{4})(?!\d)/.exec(text)?.[1] ?? /^(?:尾号|手机尾号|末四位)?\s*(\d{4})(?:号)?$/.exec(text)?.[1];
  const cleaned = text.replace(/^(?:我说的是|我要选|选择|选|是)/,'').replace(/(?:那个|那位|这个|这位|的)$/, '').trim();
  const found = rows.filter(row => row.id === text || (phone && row.phone === phone) ||
    (tail && (row.phone?.endsWith(tail) || row.last4 === tail)) ||
    [row.name,row.note,row.id].some(value => value && value === cleaned));
  return found.length === 1 ? found[0] : null;
}

export function continueIntent(state, incoming, rawText = '') {
  const pending = state.pending;
  if (!pending) return incoming;
  const text = String(rawText).trim();
  if (pending.expiresAt <= Date.now()) {
    state.pending = null;
    return incoming.kind === 'clarify' ? {kind:'clarify',slots:{question:'上次追问已过期，请重新描述完整业务。'}, expiredDraft:true} : incoming;
  }
  const old = pending.intent;
  if (!old || !['clarify',old.kind].includes(incoming.kind)) { state.pending=null; return incoming; }
  const revision = Boolean(pending.revisionOf) || correcting(text);
  const freshTarget = !revision && incoming.kind === old.kind &&
    ((incoming.slots.recipient && /(?:给|向).*(?:转|汇|打)/.test(text)) ||
     ((incoming.slots.productId || incoming.slots.productName) && /购买|申购|买入|赎回/.test(text)));
  if (freshTarget) {
    state.pending=null;
    const explicit=parseRules(text,state);
    return explicit.kind===incoming.kind?explicit:incoming;
  }
  const intent = structuredClone(old);
  if (incoming.kind === old.kind) Object.assign(intent.slots, incoming.slots);
  const p = intent.slots, missing = pending.missing ?? [];
  const answerText=text.replace(/^(?:不对[，,\s]*)?(?:改成|改为|修改为?|换成)?\s*/,'');
  const hasMoney = /(?:元|块|人民币|金额|预算)/.test(text);
  const value = extractAmount(text);
  if (['transfer','schedule_transfer'].includes(intent.kind)) {
    const needRecipient = missing.includes('recipient');
    if (needRecipient) {
      const candidate = select(text, pending.candidates?.length ? pending.candidates : state.contacts);
      if (candidate) p.recipient=candidate.id;
      else if (incoming.slots.recipient) p.recipient=incoming.slots.recipient;
    }
    if(revision&&!needRecipient){const candidate=select(answerText,state.contacts);if(candidate)p.recipient=candidate.id;}
    if ((!needRecipient && (missing.includes('amountCents') || revision)) || hasMoney) {
      if (value !== undefined) p.amountCents=value;
      else if (hasMoney) delete p.amountCents;
    }
    if (revision && /(?:给|向).*(?:转|汇|打)/.test(text) && incoming.slots.recipient) p.recipient=incoming.slots.recipient;
    if (intent.kind === 'schedule_transfer' && /明天|后天|今天|月|日|号|20\d\d-/.test(text)) {
      const date = dateFor(text,state); if (date) p.executeAt=date;
    }
  } else if (['own_deposit','own_withdraw'].includes(intent.kind)) {
    if(missing.includes('ownCardId')){const card=select(text,state.ownCards??[]);if(card)p.ownCardId=card.id;}
    if(missing.includes('amountCents')||hasMoney||revision){if(value!==undefined)p.amountCents=value;else if(hasMoney)delete p.amountCents;}
  } else if (['wealth_buy','wealth_redeem'].includes(intent.kind)) {
    if (missing.includes('productId')) {
      const product=select(text,state.products); if(product){p.productId=product.id;p.productName=product.name;}
    }
    if (intent.kind === 'wealth_buy' && (missing.includes('amountCents') || revision || hasMoney)) {
      if(value!==undefined)p.amountCents=value;else if(hasMoney)delete p.amountCents;
    }
    if(intent.kind==='wealth_buy'&&missing.includes('cardId')){const card=select(text,pending.candidates?.length?pending.candidates:state.cards.filter(item=>item.type==='debit'&&item.status==='active'));if(card)p.cardId=card.id;}
    if(intent.kind==='wealth_redeem' && /(?:\d+\s*份|^\d+$)/.test(text))p.shares=Number(/\d+/.exec(text)[0]);
  } else if (intent.kind==='event_plan') {
    const date=dateFor(text,state,true); if(date)p.eventDate=date;
    if (missing.includes('budgetCents') || revision || hasMoney) {
      if(value!==undefined)p.budgetCents=value;else if(hasMoney)delete p.budgetCents;
    }
    const days=/(?:提前|生日前?)\s*(\d+)\s*天/.exec(text);if(days)p.daysBefore=Number(days[1]);
  } else if (intent.kind==='aa_request') {
    const people=/(\d+|[二两三四五六七八九十]+)\s*个?人/.exec(text)?.[1];
    if(people)p.participants=parseAmount(people)/100;
    else if(missing.includes('participants')&&/^\d+$/.test(text))p.participants=Number(text);
    if(hasMoney||missing.includes('totalCents')){if(value!==undefined&&!people)p.totalCents=value;else if(hasMoney&&value!==undefined)p.totalCents=value;}
  } else if (intent.kind==='budget_reserve') {
    if(value!==undefined)p.amountCents=value;
  } else if (intent.kind==='green_watch_create') {
    if(hasMoney||revision){if(value!==undefined)p.thresholdCents=value;else if(hasMoney)delete p.thresholdCents;}
    const duration=/(?:有效期|持续|为期|未来)\s*(\d+)\s*天/.exec(text),interval=/每\s*(\d+)\s*天/.exec(text);
    if(duration)p.durationDays=Number(duration[1]);
    if(interval)p.intervalDays=Number(interval[1]);
  } else if (['cancel_schedule','schedule_reauthorize'].includes(intent.kind)) {
    const candidate=select(text,state.schedules.filter(s=>s.status===(intent.kind==='cancel_schedule'?'scheduled':'awaiting_confirmation')));if(candidate)p.scheduleId=candidate.id;
  } else if (intent.kind==='subscription_cancel') {
    const candidate=select(text,state.subscriptions.filter(s=>s.status==='active'));if(candidate){p.subscriptionId=candidate.id;p.subscriptionName=candidate.name;}
  } else if (intent.kind.startsWith('card_')) {
    const candidate=select(text,state.cards);if(candidate){p.cardId=candidate.id;p.cardName=candidate.name;}
    if(intent.kind==='card_limit'&&(missing.includes('limitCents')||hasMoney)&&value!==undefined)p.limitCents=value;
  }
  if(revision && incoming.kind==='clarify' && value===undefined && !hasMoney && !missing.length &&
    !select(answerText,state.contacts) && !dateFor(text,state,intent.kind==='event_plan') && !/(?:份|提前|生日|尾号)/.test(text)) {
    return {kind:'clarify',slots:{question:'原计划已取消。请完整说明要改成的金额、对象或日期，再生成新计划。'}, expiredDraft:true};
  }
  if(pending.composite?.intent?.kind==='composite'&&Number.isInteger(pending.composite.index)){
    const parent=structuredClone(pending.composite.intent);
    if(parent.slots?.actions?.[pending.composite.index]){
      parent.slots.actions[pending.composite.index]=intent;
      return parent;
    }
  }
  return intent;
}

export function requestTextFor(state, steps) {
  const yuan=n=>(n/100).toFixed(2);
  return steps.map(({tool,params:p})=>{
    if(['own_deposit','own_withdraw'].includes(tool))return `${tool==='own_deposit'?'从本人卡':'转出到本人卡'}尾号${p.last4}${tool==='own_deposit'?'存入':''}${yuan(p.amountCents)}元`;
    const contact=state.contacts.find(c=>c.id===p.recipient);
    const recipient=contact?.phone??p.recipientName??p.recipient;
    if(tool==='transfer'||tool==='schedule_transfer')return `${tool==='schedule_transfer'?p.executeAt+' ':''}给${recipient}转${yuan(p.amountCents)}元${p.memo?'，备注'+p.memo:''}`;
    if(tool==='event_plan')return `${p.eventDate}是爱人生日，提前${p.daysBefore}天订购鲜花和蛋糕，预留${yuan(p.budgetCents)}元`;
    if(tool==='wealth_buy')return `购买${p.productName}${yuan(p.amountCents)}元`;
    if(tool==='wealth_redeem')return `赎回${p.productName}${p.shares}份`;
    if(tool==='aa_request')return `${p.participants}人AA分摊${yuan(p.totalCents)}元`;
    if(tool==='subscription_cancel')return `取消订阅${p.subscriptionId}`;
    if(tool==='cancel_schedule')return `取消预约${p.scheduleId}`;
    if(tool==='budget_reserve')return `为${p.title}预留${yuan(p.amountCents)}元预算`;
    if(tool==='budget_release')return `释放预算${p.goalId}`;
    if(tool==='green_watch_create')return `关注交通支出，超过${yuan(p.thresholdCents)}元提醒，有效期${p.durationDays}天，每${p.intervalDays}天检查`;
    if(tool==='card_limit')return `${p.cardName}额度调整到${yuan(p.limitCents)}元`;
    return `${{card_apply:'申请',card_lock:'锁定',card_unlock:'解锁',card_loss:'挂失'}[tool]??''}${p.cardName??''}`;
  }).join('，然后');
}
