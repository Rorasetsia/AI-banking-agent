import {randomUUID,randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {appendAudit} from './store.mjs';
import {analyze,cashflow,detectRecurring} from './analytics.mjs';
import {RULE_INPUT} from './rules.mjs';
import {prepareTurn,continueIntent,requestTextFor} from './conversation.mjs';
import {ensureOwnFunds,normalizeOwnFunds,applyOwnFunds} from './own-funds.mjs';
import {assessOperationRisk} from './operation-risk.mjs';
import {ensureServices,normalizeServiceStep,applyServiceStep} from './service-operations.mjs';
import {GREEN_WRITE_KINDS,normalizeGreenStep,applyGreenStep} from './green-finance.mjs';
import {validRiskAnswers,scoreRiskAnswers,RISK_QUESTIONNAIRE} from './risk-assessment.mjs';
import {clarificationQuestions} from './clarification-ui.mjs';

export class BusinessError extends Error {
  constructor(code,message,status=400){super(message);this.code=code;this.status=status;}
}
const fail=(code,message,status=400)=>{throw new BusinessError(code,message,status);};
const id=prefix=>`${prefix}-${randomUUID()}`;
const clone=value=>structuredClone(value);
const money=c=>`¥${(c/100).toFixed(2)}`;
const writeKinds=new Set(['own_deposit','own_withdraw','transfer','aa_request','schedule_transfer','cancel_schedule','wealth_buy','wealth_redeem','subscription_cancel','card_apply','card_limit','card_lock','card_unlock','card_loss','budget_reserve','event_plan']);
const iso=value=>new Date(value).toISOString();
function scheduleScope(state,task){const card=state.cards.find(c=>c.id==='card-debit');return createHash('sha256').update(JSON.stringify({type:task.type,params:task.params,executeAt:task.executeAt,card:{id:card?.id,status:card?.status,perTxLimitCents:card?.perTxLimitCents}})).digest('hex');}
writeKinds.add('schedule_reauthorize');
for(const kind of GREEN_WRITE_KINDS)writeKinds.add(kind);
for(const kind of ['service_mandate_create','service_mandate_pause','service_mandate_resume','service_mandate_revoke','service_dispute_draft'])writeKinds.add(kind);
function positive(value,label='金额') { if(!Number.isSafeInteger(value)||value<=0||value>9999999900)fail('INVALID_AMOUNT',`${label}必须是合法的正数，金额最多两位小数。`); return value; }
function future(value,now) {const n=Date.parse(value);if(!Number.isFinite(n)||n<=Date.parse(now))fail('INVALID_DATE','执行时间必须为有效的未来日期。');return iso(value);}
function cardFor(state,slots={}) {
  const name=slots.cardName;
  const tail=typeof name==='string'?/(?:尾号|卡号)\s*(\d{4})(?!\d)/.exec(name)?.[1]:undefined;
  const type=['信用卡','借记卡','储蓄卡'].includes(name)?(name==='信用卡'?'credit':'debit'):undefined;
  const candidates=slots.cardId?state.cards.filter(c=>c.id===slots.cardId):typeof name==='string'?state.cards.filter(c=>c.name===name||c.last4===name||(tail&&c.last4===tail)||(type&&c.type===type)):[];
  if(candidates.length!==1)fail('CARD_REQUIRED','请指定借记卡、信用卡，或卡片尾号。');
  return candidates[0];
}
function redeemable(holding,now) {
  if(!holding)return 0;
  if(Array.isArray(holding.lots))return holding.lots.filter(l=>Date.parse(l.availableAt)<=Date.parse(now)).reduce((n,l)=>n+l.shares,0);
  return holding.availableAt&&Date.parse(now)<Date.parse(holding.availableAt)?0:holding.shares;
}
function spending(state,cents,ownReserve=0,cardId='card-debit') {
  positive(cents);
  const card=state.cards.find(c=>c.id===cardId);
  if(!card||card.type!=='debit'||card.status!=='active')fail('CARD_UNAVAILABLE','所选借记卡已锁定、挂失或不存在，请重新选择。',409);
  if(cents>card.perTxLimitCents)fail('LIMIT_EXCEEDED',`超出借记卡单笔限额 ${money(card.perTxLimitCents)}。`,409);
  if(cents>state.account.balanceCents-state.account.reservedCents+ownReserve)fail('INSUFFICIENT_FUNDS','可用余额不足；预留资金不能用于其他交易。',409);
  return card;
}
function productFor(state,slots) {
  const found=state.products.filter(p=>slots.productId?p.id===slots.productId:p.name===slots.productName);
  if(found.length!==1)fail('PRODUCT_REQUIRED','请指定要操作的理财产品。');
  return found[0];
}
function tx(state,amountCents,merchant,category,kind,memo) {
  const row={id:id('tx'),amountCents,merchant,category,kind,memo:memo??'',date:iso(state.now)};
  state.transactions.push(row);state.account.balanceCents+=amountCents;return row.id;
}
function ask(state,intent,question,candidates=[],missing=[]) {
  state.pending={intent:clone(intent),question,candidates:clone(candidates),missing,expiresAt:Date.now()+600000};
  const questions=clarificationQuestions(state,state.pending);
  state.pending.questions=questions;
  return {reply:question,clarification:{question,candidates,missing,questions},trace:['发现缺失或歧义信息，暂停执行并请求补充']};
}
function normalizeStep(state,intent) {
  const green=normalizeGreenStep(state,intent);if(green)return green;
  const own=normalizeOwnFunds(state,intent);if(own)return own;
  const service=normalizeServiceStep(state,intent);if(service)return service;
  const p=clone(intent.slots??{}),tool=intent.kind;
  let label=tool,impactCents=0,warnings=[];
  if(tool==='schedule_reauthorize'){
    const task=state.schedules.find(s=>s.id===p.scheduleId&&s.status==='awaiting_confirmation');
    if(!task)fail('SCHEDULE_NOT_FOUND','预约不处于待重新授权状态。',409);
    if(task.type==='transfer')normalizeStep(state,{kind:'transfer',slots:task.params});
    else if(task.type==='birthday_order')spending(state,task.params.totalCents,task.params.budgetCents);
    else fail('UNKNOWN_SCHEDULE','不支持的预约。');
    p.scheduleId=task.id;p.amountCents=task.params.totalCents??task.params.amountCents;
    label=`按当前条件重新授权：${task.title}`;warnings.push('本次密码与设备核验后仅恢复这笔预约；请再次推进演示时钟执行，金额与商品仍受原任务限制。');
  } else if(['transfer','schedule_transfer'].includes(tool)) {
    const found=state.contacts.filter(c=>c.id===p.recipient||c.name===p.recipient||c.phone===p.recipient||c.note===p.recipient);
    if(found.length!==1)fail('RECIPIENT_AMBIGUOUS','收款人未能唯一匹配，请补充姓名、手机号或备注。');
    positive(p.amountCents);p.recipient=found[0].id;p.recipientName=found[0].name;p.phoneTail=found[0].phone.slice(-4);
    if(p.memo!==undefined&&(typeof p.memo!=='string'||p.memo.length>120))fail('INVALID_MEMO','备注最多120字。');
    spending(state,p.amountCents);impactCents=tool==='transfer'?p.amountCents:0;
    if(tool==='schedule_transfer')p.executeAt=future(p.executeAt,state.now);
    label=`${tool==='transfer'?'转账':'预约转账'}给 ${p.recipientName}（尾号${p.phoneTail}）${money(p.amountCents)}`;
    if(tool==='schedule_transfer')warnings.push('到期将再次核验可用余额、卡片状态和限额，资金不会在预约时扣除。');
    if(p.amountCents>=1000000)warnings.push('大额转账，请仔细核对收款人和用途。');
  } else if(tool==='aa_request') {
    positive(p.totalCents,'AA总额');if(!Number.isInteger(p.participants)||p.participants<2||p.participants>20)fail('INVALID_PARTICIPANTS','AA人数需为2到20人，包含自己。');
    const base=Math.floor(p.totalCents/p.participants),remainder=p.totalCents%p.participants;
    if(base<1)fail('INVALID_AMOUNT','每人分摊至少0.01元。');
    p.splits=Array.from({length:p.participants},(_,i)=>({name:i===0?'我':`参与人${i+1}`,amountCents:base+(i<remainder?1:0),status:i===0?'self':'pending'}));
    label=`${p.participants}人分摊 ${money(p.totalCents)}`;warnings.push('创建模拟收款请求；其他参与人未支付，不计入到账收入。');
  } else if(tool==='cancel_schedule') {
    const schedule=state.schedules.find(s=>s.id===p.scheduleId);
    if(!schedule||!['scheduled','awaiting_confirmation'].includes(schedule.status))fail('SCHEDULE_NOT_FOUND','预约不存在或已不可取消。',409);
    p.scheduleId=schedule.id;label=`取消预约：${schedule.title}`;
  } else if(['wealth_buy','wealth_redeem'].includes(tool)) {
    const product=productFor(state,p);p.productId=product.id;p.productName=product.name;
    if(tool==='wealth_buy') {
      positive(p.amountCents);if(typeof p.cardId!=='string'||!p.cardId)fail('CARD_REQUIRED','请先选择本次申购使用的借记卡。',409);const card=spending(state,p.amountCents,0,p.cardId);p.cardId=card.id;p.cardName=`${card.name} 尾号${card.last4}`;p.last4=card.last4;
      if(!state.risk)fail('RISK_REQUIRED','请先在财富计划完成风险评估。',409);
      if(state.risk.questionnaireVersion!==RISK_QUESTIONNAIRE.version)fail('RISK_REASSESS_REQUIRED','问卷已更新，请在财富计划完成新版12题评估后再申购。旧记录保留供查看。',409);
      if(Date.parse(state.now)-Date.parse(state.risk.assessedAt)>365*86400000)fail('RISK_EXPIRED','风险评估已过期，请重新评估。',409);
      if(product.riskLevel>state.risk.level)fail('RISK_MISMATCH',`产品R${product.riskLevel}高于当前风险等级R${state.risk.level}。`,409);
      if(p.amountCents<product.minCents||p.amountCents%product.unitPriceCents!==0)fail('INVALID_PURCHASE',`起购 ${money(product.minCents)}，金额需为单位净值 ${money(product.unitPriceCents)} 的整数倍。`);
      p.shares=p.amountCents/product.unitPriceCents;impactCents=p.amountCents;label=`申购 ${product.name} ${money(p.amountCents)}`;
    } else {
      positive(p.shares,'赎回份额');const holding=state.holdings.find(h=>h.productId===product.id);
      if(!holding||p.shares>holding.shares)fail('INSUFFICIENT_SHARES','可赎回份额不足。',409);
      if(p.shares>redeemable(holding,state.now))fail('HOLDING_LOCKED','本次份额超过当前已到期可赎回份额。',409);
      p.amountCents=p.shares*product.unitPriceCents;positive(p.amountCents);impactCents=-p.amountCents;label=`赎回 ${product.name} ${p.shares}份`;
    }
    warnings.push(tool==='wealth_buy'?`使用借记卡尾号${p.last4}。申购为独立模拟，基金净值会波动，本金可能亏损；基金申购份额与成交以实际交易规则为准。`: '赎回为独立模拟，实际到账时间以基金规则为准。');
  } else if(tool==='subscription_cancel') {
    const found=state.subscriptions.filter(s=>p.subscriptionId?s.id===p.subscriptionId:s.name===p.subscriptionName);
    if(found.length!==1)fail('SUBSCRIPTION_REQUIRED','请指定要取消的订阅名称。');
    const sub=found[0];if(sub.status!=='active')fail('SUBSCRIPTION_INACTIVE','该订阅已经取消。',409);
    p.subscriptionId=sub.id;p.subscriptionName=sub.name;label=`取消 ${sub.name} 的模拟环境代扣授权`;
    warnings.push(sub.source==='detected'?'这是从重复流水识别的候选记录，本操作只移除模拟环境候选。':'只取消模拟环境代扣授权，不代表已在真实商户退订。');
  } else if(tool==='card_apply') {
    p.cardName=typeof p.cardName==='string'?p.cardName:'信用卡';label=`提交${p.cardName}模拟申请`;warnings.push('只生成待审核的模拟环境申请记录，不代表真实授信。');
  } else if(tool.startsWith('card_')) {
    const card=cardFor(state,p);p.cardId=card.id;p.cardName=card.name;p.last4=card.last4;
    if(card.status==='lost')fail('CARD_LOST','挂失卡片不能直接解锁或调整，请另行申请新卡。',409);
    if(tool==='card_limit') {positive(p.limitCents,'额度');if(p.limitCents>5000000)fail('LIMIT_RANGE','模拟环境额度或单笔限额最多50,000元。');label=`${card.name} ${card.type==='credit'?'额度':'单笔限额'}调整为 ${money(p.limitCents)}`;}
    else if(['card_lock','card_unlock','card_loss'].includes(tool))label=`${{card_lock:'锁定',card_unlock:'解锁',card_loss:'挂失'}[tool]} ${card.name}（尾号${card.last4}）`;
    else fail('UNKNOWN_TOOL','不支持的卡片操作。');
    if(tool==='card_loss')warnings.push('挂失后不能通过普通解锁恢复，后续资金操作将被阻止。');
  } else if(tool==='budget_reserve') {
    positive(p.amountCents);if(p.amountCents>state.account.balanceCents-state.account.reservedCents)fail('INSUFFICIENT_FUNDS','可用资金不足以预留预算。',409);
    p.title=typeof p.title==='string'?p.title.slice(0,60):'专用预算';label=`为${p.title}预留 ${money(p.amountCents)}`;warnings.push('预留减少可用余额，不会直接扣款。');
  } else if(tool==='event_plan') {
    positive(p.budgetCents,'生日预算');
    if(typeof p.eventDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(p.eventDate)||new Date(`${p.eventDate}T00:00:00+08:00`).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})!==p.eventDate)fail('INVALID_DATE','请提供真实有效的生日日期。');
    if(!Number.isInteger(p.daysBefore)||p.daysBefore<1||p.daysBefore>30)fail('INVALID_DAYS','提前天数应为1至30天。');
    p.executeAt=future(new Date(Date.parse(`${p.eventDate}T09:00:00+08:00`)-p.daysBefore*86400000).toISOString(),state.now);
    if(p.eventDate.slice(0,7)!==new Date(Date.parse(state.now)+8*3600000).toISOString().slice(0,7))fail('EVENT_MONTH','当前模拟环境先支持生日当月预留，请将演示时间推进到生日当月再建立计划。');
    p.items=[{name:'鲜花花束（模拟商户）',quantity:1,priceCents:29900},{name:'生日蛋糕（模拟商户）',quantity:1,priceCents:19900}];p.totalCents=49800;
    if(p.budgetCents<p.totalCents)fail('BUDGET_TOO_LOW','模拟鲜花299元、蛋糕199元，预算至少需要498元。');
    if(p.budgetCents>state.account.balanceCents-state.account.reservedCents)fail('INSUFFICIENT_FUNDS','当前可用余额不足以锁定生日预算。',409);
    p.title='爱人生日 · 鲜花与蛋糕';label=`预留 ${money(p.budgetCents)}，${new Date(p.executeAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})} 自动模拟下单 ${money(p.totalCents)}`;
    warnings.push('本次确认仅授权列表中固定商品、固定金额、指定日期的模拟环境订单；不会向真实商户购买。','到期成功后释放未使用的预算；失败或撤销将释放本计划预留。');
  } else fail('UNKNOWN_TOOL','该操作不在工具白名单内。');
  return {step:{tool,params:p,label},impactCents,warnings};
}

function clarifyOperation(state,intent){
  const p=intent.slots;
  if(['own_deposit','own_withdraw'].includes(intent.kind)){
    if(!p.ownCardId)return ask(state,intent,'请选择本人绑定卡或回复尾号0618、0926。',state.ownCards,['ownCardId']);
    if(p.amountCents===undefined)return ask(state,intent,'请明确本人账户互转金额，例如100元。',[],['amountCents']);
  }
  if(['transfer','schedule_transfer'].includes(intent.kind)) {
    if(!p.recipient)return ask(state,intent,'请告诉我收款人姓名、完整手机号或联系人备注。',[],['recipient']);
    const contacts=state.contacts.filter(c=>[c.id,c.name,c.phone,c.note].includes(p.recipient));
    if(contacts.length!==1)return ask(state,intent,contacts.length?`找到${contacts.length}位“${p.recipient}”，请回复手机号尾号：${contacts.map(c=>`${c.name}（${c.note}，尾号${c.phone.slice(-4)}）`).join('、')}。`:'未找到这个收款人，请补充已有联系人姓名或完整手机号。',contacts,['recipient']);
    if(p.amountCents===undefined)return ask(state,intent,'请补充转账金额，例如“100元”。',[],['amountCents']);
    if(intent.kind==='schedule_transfer'&&p.executeAt===undefined)return ask(state,intent,'请补充预约日期与时间，例如“明天9点”。',[],['executeAt']);
  }
  if(['wealth_buy','wealth_redeem'].includes(intent.kind)) {
    if(!p.productId&&!p.productName)return ask(state,intent,'请选择要操作的理财产品。',state.products,['productId']);
    if(intent.kind==='wealth_buy'&&p.amountCents===undefined)return ask(state,intent,'请补充申购金额，例如“100元”。',[],['amountCents']);
    if(intent.kind==='wealth_buy'&&!p.cardId)return ask(state,intent,'请选择本次申购使用的扣款借记卡；请回复卡片尾号。',state.cards.filter(card=>card.type==='debit'&&card.status==='active'),['cardId']);
    if(intent.kind==='wealth_redeem'&&p.shares===undefined)return ask(state,intent,'请补充赎回份额，例如“100份”。',[],['shares']);
  }
  if(intent.kind==='event_plan') {
    if(!p.eventDate)return ask(state,intent,'请提供爱人的生日日期，例如2026-10-25。',[],['eventDate']);
    if(p.budgetCents===undefined)return ask(state,intent,'鲜花和蛋糕合计498元，请明确要预留的预算，例如“预留1000元”。',[],['budgetCents']);
    p.daysBefore??=2;
  }
  if(intent.kind==='aa_request') {
    if(p.totalCents===undefined)return ask(state,intent,'请补充AA总金额，例如“300元”。',[],['totalCents']);
    if(p.participants===undefined)return ask(state,intent,'请补充AA人数，包含自己，例如“3人”。',[],['participants']);
  }
  if(intent.kind==='budget_reserve'&&p.amountCents===undefined)return ask(state,intent,'请补充要预留的金额。',[],['amountCents']);
  if(intent.kind==='cancel_schedule'&&!p.scheduleId) {
    const choices=state.schedules.filter(s=>s.status==='scheduled');
    if(choices.length===1)p.scheduleId=choices[0].id;
    else if(choices.length)return ask(state,intent,'请选择要取消的预约。',choices,['scheduleId']);
  }
  if(intent.kind==='schedule_reauthorize'&&!p.scheduleId){
    const choices=state.schedules.filter(s=>s.status==='awaiting_confirmation');
    if(choices.length)return ask(state,intent,'请选择要重新授权的预约。',choices,['scheduleId']);
  }
  if(intent.kind==='subscription_cancel'&&!p.subscriptionId&&!p.subscriptionName)return ask(state,intent,'请选择要取消的模拟环境代扣或识别候选。',state.subscriptions.filter(s=>s.status==='active'),['subscriptionId']);
  if(['card_lock','card_unlock','card_loss','card_limit'].includes(intent.kind)) {
    if(!p.cardId&&!p.cardName)return ask(state,intent,'请选择卡片或回复卡片尾号。',state.cards,['cardId']);
    if(intent.kind==='card_limit'&&p.limitCents===undefined)return ask(state,intent,'请补充新的额度或单笔限额。',[],['limitCents']);
  }
  return null;
}

export function buildPlan(state,rawIntent,{rawText}={}) {
  ensureOwnFunds(state);
  ensureServices(state);
  rawText??=rawIntent?.[RULE_INPUT]??'';
  const prepared=prepareTurn(state,rawText);if(prepared)return prepared;
  let intent=clone(rawIntent);
  if(!intent||typeof intent.kind!=='string'||!intent.slots||typeof intent.slots!=='object')fail('INVALID_INTENT','无法识别业务意图。');
  intent=continueIntent(state,intent,rawText);
  if(intent.expiredDraft)return {reply:intent.slots.question,trace:['原授权不可执行；请补充完整请求']};
  if(intent.kind!=='clarify')state.pending=null;
  const p=intent.slots;
  const candidates=intent.kind==='composite'?p.actions:[intent];
  if(intent.kind==='composite'&&(!Array.isArray(candidates)||!candidates.length||candidates.length>5||candidates.some(action=>!action||!writeKinds.has(action.kind)||!action.slots||typeof action.slots!=='object')))fail('INVALID_ACTIONS','组合计划仅支持1至5个明确的写操作。');
  for(let index=0;index<(candidates?.length??0);index++){
    const clarification=clarifyOperation(state,candidates[index]);
    if(clarification){
      if(intent.kind==='composite')state.pending.composite={intent:clone(intent),index};
      return clarification;
    }
  }
  if(intent.kind==='analytics') {const answer=analyze(state,p);state.pending=null;return {reply:`${answer.title}共${answer.count}笔流水，收入${money(answer.incomeCents)}，支出${money(answer.expenseCents)}，净流入${money(answer.netCents)}。发现${answer.anomalies.length}条需核对的记录，可到“账单洞察”查看明细。`,answer,sources:answer.sources,trace:['读取当前会话流水','按指定周期和分类汇总','核对大额与同日重复扣款规则']};}
  if(intent.kind==='wealth_compare')return {reply:`当前${state.risk?`项目演示适当性档位R${state.risk.level}`:'尚未完成风险评估，申购前请到财富计划填写问卷'}。产品目录：${state.products.map(x=>`${x.name}（${x.code??x.id}，${x.category??'基金'}），演示档位R${x.riskLevel}`).join('；')}。基金资料链接与正式法律文件请在财富计划核对；本项目不提供投资建议，所有申购和份额均为独立模拟。`,sources:{productIds:state.products.map(x=>x.id)},trace:['读取公募基金公开目录','读取项目演示适当性档位，未执行申购']};
  if(intent.kind==='subscription_list')return {reply:state.subscriptions.map(s=>`${s.name}：${money(s.amountCents)}/${s.cycleDays}天，${s.status==='active'?'有效':'已取消'}${s.source==='detected'?'（重复流水识别候选）':''}`).join('；'),sources:{subscriptionIds:state.subscriptions.map(s=>s.id)},trace:['读取模拟环境代扣授权与识别候选']};
  if(intent.kind==='card_list')return {reply:state.cards.map(c=>`${c.name}尾号${c.last4}：${{active:'正常',locked:'已锁定',lost:'已挂失'}[c.status]}，单笔限额${money(c.perTxLimitCents)}`).join('；'),sources:{cardIds:state.cards.map(c=>c.id)},trace:['读取本会话卡片状态']};
  if(intent.kind==='account')return {reply:`模拟环境活期余额${money(state.account.balanceCents)}，预留${money(state.account.reservedCents)}，可用${money(state.account.balanceCents-state.account.reservedCents)}。`,sources:{accountIds:[state.account.id],asOf:state.now},trace:['读取账户余额与预算预留']};
  if(intent.kind==='refuse')return {reply:String(p.reason??'无法执行越权或绕过确认的操作。'),trace:['权限边界检查：拒绝越权要求']};
  if(intent.kind==='help'||intent.kind==='clarify')return {reply:intent.kind==='help'?'可以帮你转账、AA收款、分析账单、比较和申赎理财、管理卡片、取消代扣，以及安排生日预算与模拟购买。资金操作会先给你计划，确认后执行。':'请描述具体银行业务，例如“给林悦转520元”“分析本月账单”。',trace:['未创建任何执行计划']};
  const actions=intent.kind==='composite'?p.actions:[intent];
  if(!Array.isArray(actions)||actions.length<1||actions.length>5||actions.some(a=>!writeKinds.has(a.kind)))fail('INVALID_ACTIONS','组合计划仅支持1至5个明确的写操作。');
  const preview=clone(state),parts=[];
  for(const action of actions) {
    const normalized=normalizeStep(preview,action);parts.push(normalized);
    // Preview sequential policy changes on a private copy; original balances remain unchanged.
    applyStep(preview,normalized.step);
  }
  const plan={id:id('plan'),nonce:randomBytes(24).toString('hex'),status:'pending',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString(),demoExpiresAt:new Date(Date.parse(state.now)+600000).toISOString(),title:parts.length===1?parts[0].step.label:`组合计划 · ${parts.length}项操作`,summary:'请核对以下操作，确认后仅在独立银行模拟环境执行。',steps:parts.map(x=>x.step),impactCents:parts.reduce((s,x)=>s+x.impactCents,0),warnings:[...new Set(parts.flatMap(x=>x.warnings))]};
  plan.operationRisk=assessOperationRisk(state,{...plan,requestText:rawText});
  plan.requestIntent=clone(intent);plan.requestText=requestTextFor(state,plan.steps);
  state.plans.push(plan);state.pending=null;appendAudit(state,'plan_created',{planId:plan.id,tools:plan.steps.map(s=>s.tool)});
  return {reply:`已准备：${plan.title}。尚未执行，请核对并确认。`,plan:clone(plan),trace:['识别业务意图','读取账户与目标记录','校验权限、资金与风险','生成待确认计划，未执行资金操作']};
}

function applyStep(state,step) {
  if(['own_deposit','own_withdraw'].includes(step.tool))return applyOwnFunds(state,step);
  if(GREEN_WRITE_KINDS.includes(step.tool))return applyGreenStep(state,step);
  if(step.tool.startsWith('service_'))return applyServiceStep(state,step);
  const p=step.params,tool=step.tool,transactionIds=[];
  if(tool==='schedule_reauthorize'){
    const task=state.schedules.find(s=>s.id===p.scheduleId&&s.status==='awaiting_confirmation');
    if(!task)fail('SCHEDULE_NOT_FOUND','预约状态已变化。',409);
    task.status='scheduled';delete task.error;task.authorization={methods:['password','device'],scopeHash:scheduleScope(state,task),verifiedAt:new Date().toISOString()};
  } else if(tool==='transfer') {
    spending(state,p.amountCents);const c=state.contacts.find(c=>c.id===p.recipient);if(!c)fail('RECIPIENT_NOT_FOUND','收款人已不存在。');
    transactionIds.push(tx(state,-p.amountCents,c.name,'转账','transfer',p.memo));
  } else if(tool==='schedule_transfer')state.schedules.push({id:id('schedule'),type:'transfer',title:step.label,executeAt:p.executeAt,status:'scheduled',params:clone(p),createdAt:iso(state.now)});
  else if(tool==='aa_request')state.goals.push({id:id('aa'),type:'aa_request',title:'AA收款',totalCents:p.totalCents,participants:p.participants,splits:clone(p.splits),status:'pending',createdAt:iso(state.now)});
  else if(tool==='cancel_schedule') {
    const schedule=state.schedules.find(s=>s.id===p.scheduleId);if(!schedule||!['scheduled','awaiting_confirmation'].includes(schedule.status))fail('SCHEDULE_NOT_FOUND','预约已不可取消。',409);
    schedule.status='cancelled';releaseReservation(state,schedule,'cancelled');
  } else if(tool==='wealth_buy') {
    const product=productFor(state,p);if(typeof p.cardId!=='string'||!p.cardId)fail('CARD_REQUIRED','申购计划未绑定扣款借记卡。请返回产品页选择银行卡并重新确认。',409);spending(state,p.amountCents,0,p.cardId);
    if(state.risk?.questionnaireVersion!==RISK_QUESTIONNAIRE.version)fail('RISK_REASSESS_REQUIRED','问卷版本已更新，请重新评估并生成申购方案。',409);
    if(!state.risk||state.risk.level<product.riskLevel)fail('RISK_MISMATCH','当前风险等级不满足申购要求。',409);
    let holding=state.holdings.find(h=>h.productId===p.productId);
    if(!holding){holding={productId:p.productId,shares:0};state.holdings.push(holding);}
    holding.lots??=holding.shares?[{shares:holding.shares,availableAt:holding.availableAt??iso(state.now)}]:[];
    holding.lots.push({shares:p.shares,availableAt:new Date(Date.parse(state.now)+(product.termDays>1?product.termDays:0)*86400000).toISOString()});
    holding.shares+=p.shares;delete holding.availableAt;
    transactionIds.push(tx(state,-p.amountCents,product.name,'理财','wealth','模拟申购'));
  } else if(tool==='wealth_redeem') {
    const holding=state.holdings.find(h=>h.productId===p.productId);if(!holding||holding.shares<p.shares)fail('INSUFFICIENT_SHARES','赎回份额不足。',409);
    if(p.shares>redeemable(holding,state.now))fail('HOLDING_LOCKED','本次份额超过已到期可赎回份额。',409);
    if(holding.lots){let remain=p.shares;for(const lot of holding.lots){if(Date.parse(lot.availableAt)>Date.parse(state.now))continue;const take=Math.min(lot.shares,remain);lot.shares-=take;remain-=take;}holding.lots=holding.lots.filter(l=>l.shares>0);}
    holding.shares-=p.shares;transactionIds.push(tx(state,p.amountCents,p.productName,'理财','wealth','模拟赎回'));
  } else if(tool==='subscription_cancel') {
    const sub=state.subscriptions.find(s=>s.id===p.subscriptionId);if(!sub||sub.status!=='active')fail('SUBSCRIPTION_INACTIVE','订阅已不在活跃状态。',409);sub.status='cancelled';
  } else if(tool==='card_apply')state.goals.push({id:id('application'),type:'card_application',title:`${p.cardName}模拟申请`,status:'pending_review',createdAt:iso(state.now)});
  else if(tool.startsWith('card_')) {
    const card=state.cards.find(c=>c.id===p.cardId);if(!card||card.status==='lost')fail('CARD_UNAVAILABLE','卡片已挂失或不存在。',409);
    if(tool==='card_limit'){if(card.type==='credit'){card.limitCents=p.limitCents;card.perTxLimitCents=Math.min(card.perTxLimitCents,p.limitCents);}else card.perTxLimitCents=p.limitCents;}
    else card.status={card_lock:'locked',card_unlock:'active',card_loss:'lost'}[tool];
  } else if(tool==='budget_reserve') {
    if(p.amountCents>state.account.balanceCents-state.account.reservedCents)fail('INSUFFICIENT_FUNDS','可用余额不足以预留。',409);
    state.account.reservedCents+=p.amountCents;state.goals.push({id:id('goal'),type:'reserve',title:p.title,amountCents:p.amountCents,status:'reserved',createdAt:iso(state.now)});
  } else if(tool==='event_plan') {
    if(p.budgetCents>state.account.balanceCents-state.account.reservedCents)fail('INSUFFICIENT_FUNDS','生日预算预留失败。',409);
    state.account.reservedCents+=p.budgetCents;
    const task={id:id('schedule'),type:'birthday_order',title:p.title,executeAt:p.executeAt,status:'scheduled',params:clone(p),createdAt:iso(state.now)};
    state.schedules.push(task);state.goals.push({id:id('goal'),type:'birthday_reserve',title:p.title,amountCents:p.budgetCents,scheduleId:task.id,status:'reserved',createdAt:iso(state.now)});
  } else fail('UNKNOWN_TOOL','执行工具不在白名单中。');
  return transactionIds;
}
function checkPlan(state,planId,nonce) {
  const plan=state.plans.find(p=>p.id===planId);if(!plan)fail('PLAN_NOT_FOUND','计划不存在或不属于当前会话。',404);
  if(typeof nonce!=='string'||!/^[a-f0-9]{48}$/.test(nonce)||!timingSafeEqual(Buffer.from(nonce),Buffer.from(plan.nonce)))fail('NONCE_MISMATCH','确认凭证无效。',403);
  return plan;
}
export function confirmPlan(state,planId,nonce) {
  const plan=checkPlan(state,planId,nonce);
  if(plan.status==='executed')return {status:'executed',receipt:clone(plan.receipt),plan:clone(plan)};
  if(plan.status!=='pending')fail('PLAN_NOT_PENDING','该计划已取消、过期或执行失败。',409);
  if(Date.parse(plan.expiresAt)<=Date.now()||Date.parse(plan.demoExpiresAt)<=Date.parse(state.now))fail('PLAN_EXPIRED','计划已过期，请重新发起。',410);
  const next=clone(state),transactionIds=[];
  for(const step of plan.steps) {
    // Reconstruct trusted original slots and revalidate against latest state.
    const validated=normalizeStep(next,{kind:step.tool,slots:step.params});
    transactionIds.push(...applyStep(next,validated.step));
  }
  const receipt={id:id('receipt'),title:plan.title,executedAt:iso(next.now),summary:'已在独立银行模拟环境执行。',transactionIds,balanceCents:next.account.balanceCents,details:plan.steps.map(s=>`${s.label}${s.tool==='wealth_buy'&&s.params.cardName?` · 扣款卡 ${s.params.cardName}`:''}`)};
  const existingSchedules=new Set(state.schedules.map(s=>s.id));
  for(const schedule of next.schedules)if(!existingSchedules.has(schedule.id)){
    schedule.authorizedByPlanId=plan.id;schedule.authorizationReceiptId=receipt.id;
    if(plan.authentication?.methods?.includes('password')&&plan.authentication?.methods?.includes('device'))schedule.authorization={methods:['password','device'],scopeHash:scheduleScope(next,schedule),verifiedAt:plan.authentication.verifiedAt};
  }
  const updated=next.plans.find(p=>p.id===planId);updated.status='executed';updated.receipt=receipt;
  appendAudit(next,'plan_executed',{planId,receiptId:receipt.id,transactionIds});
  Object.assign(state,next);return {status:'executed',receipt:clone(receipt),plan:clone(updated)};
}
export function cancelPlan(state,planId,nonce) {
  const plan=checkPlan(state,planId,nonce);if(plan.status==='cancelled')return {status:'cancelled'};
  if(plan.status!=='pending')fail('PLAN_NOT_PENDING','该计划不可取消。',409);
  plan.status='cancelled';appendAudit(state,'plan_cancelled',{planId});return {status:'cancelled'};
}
export function assessRisk(state,answers) {
  if(!validRiskAnswers(answers))fail('INVALID_ANSWERS',`请完成全部${RISK_QUESTIONNAIRE.questions.length}个风险问题，并选择有效选项。`);
  state.risk={...scoreRiskAnswers(answers),assessedAt:iso(state.now)};
  appendAudit(state,'risk_assessed',{level:state.risk.level,score:state.risk.score,questionnaireVersion:state.risk.questionnaireVersion});return clone(state.risk);
}
function releaseReservation(state,schedule,status) {
  if(schedule.type!=='birthday_order')return;
  const goal=state.goals.find(g=>g.scheduleId===schedule.id&&g.status==='reserved');
  if(goal){state.account.reservedCents-=goal.amountCents;goal.status=status;}
}
export function tickSchedules(state,asOf,{requireAuthorization=false}={}) {
  const end=Date.parse(asOf),start=Date.parse(state.now);
  if(!Number.isFinite(end)||end<start||end-start>31*86400000)fail('INVALID_TIME','演示时钟只能向前推进，单次最多31天。');
  const triggered=[];
  const tasks=state.schedules.filter(s=>s.status==='scheduled'&&Date.parse(s.executeAt)<=end).sort((a,b)=>Date.parse(a.executeAt)-Date.parse(b.executeAt));
  for(const task of tasks) {
    if(requireAuthorization&&['transfer','birthday_order'].includes(task.type)&&(!task.authorization||task.authorization.scopeHash!==scheduleScope(state,task))){
      task.status='awaiting_confirmation';task.error='缺少双因子预约授权，或卡片/限额/任务条件已变化；未扣款，请先处理条件变化后重新授权，或取消预约释放预留。';
      appendAudit(state,'schedule_reauthorization_required',{scheduleId:task.id});triggered.push({scheduleId:task.id,status:'awaiting_confirmation',error:task.error});continue;
    }
    const next=clone(state),schedule=next.schedules.find(s=>s.id===task.id);next.now=iso(Math.max(start,Date.parse(task.executeAt)));
    try {
      let transactionIds=[];
      if(task.type==='transfer') {
        const step=normalizeStep(next,{kind:'transfer',slots:task.params}).step;
        transactionIds=applyStep(next,step);
      } else if(task.type==='birthday_order') {
        const p=task.params,goal=next.goals.find(g=>g.scheduleId===task.id&&g.status==='reserved');
        if(!goal||goal.amountCents!==p.budgetCents)fail('RESERVATION_MISSING','本预约的预算预留已失效。',409);
        spending(next,p.totalCents,p.budgetCents);
        transactionIds.push(tx(next,-p.totalCents,'生日鲜花与蛋糕（模拟商户）','购物','birthday_order',p.title));
        releaseReservation(next,schedule,'spent');
        next.orders??=[];next.orders.push({id:id('order'),scheduleId:task.id,items:clone(p.items),totalCents:p.totalCents,createdAt:iso(next.now),status:'placed',sandbox:true});
      } else if(task.type!=='reminder')fail('UNKNOWN_SCHEDULE','不支持的预约类型。');
      schedule.status='executed';schedule.receipt={id:id('receipt'),title:task.title,executedAt:iso(next.now),summary:task.type==='birthday_order'?'模拟鲜花与蛋糕已下单。':'预约任务已在模拟环境执行。',transactionIds,balanceCents:next.account.balanceCents,details:[]};
      appendAudit(next,'schedule_executed',{scheduleId:task.id,transactionIds});Object.assign(state,next);
      triggered.push({scheduleId:task.id,status:'executed',receipt:clone(schedule.receipt)});
    } catch(error) {
      const failed=state.schedules.find(s=>s.id===task.id);failed.status='failed';failed.error=error.message;releaseReservation(state,failed,'failed');appendAudit(state,'schedule_failed',{scheduleId:task.id,reason:error.message});triggered.push({scheduleId:task.id,status:'failed',error:error.message});
    }
  }
  state.now=iso(end);return {triggered,now:state.now};
}
export function publicState(state) {
  const output=clone(state);
  ensureOwnFunds(output);
  ensureServices(output);
  delete output.familyLinks;delete output.riskEvents;
  delete output.chatTurnId;
  for(const plan of output.plans)plan.operationRisk=assessOperationRisk(state,plan);
  for(const plan of output.plans)if(plan.status==='pending'&&(Date.parse(plan.expiresAt)<=Date.now()||Date.parse(plan.demoExpiresAt)<=Date.parse(state.now)))plan.status='expired';
  output.analysis=analyze(state);output.cashflow=cashflow(state);output.orders??=[];
  if(output.pending&&!output.pending.questions)output.pending.questions=clarificationQuestions(output,output.pending);
  output.detectedSubscriptions=detectRecurring(state);
  for(const sub of output.subscriptions){const evidence=output.detectedSubscriptions.find(d=>d.name===sub.name);if(evidence){sub.evidenceIds=evidence.transactionIds;sub.detectionReason=evidence.reason;}}
  return output;
}
