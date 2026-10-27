import {randomUUID} from 'node:crypto';
import {appendAudit} from './seed.mjs';
import {parseAmount} from './rules.mjs';
import {greenReport,GREEN_SCOPE} from './green-analysis.mjs';
import {calculateCommute,evaluateAppliance} from './green-decisions.mjs';
import {greenGoals} from './green-goals.mjs';
export {greenReport,GREEN_SCOPE};
export const GREEN_WRITE_KINDS=['green_watch_create','budget_release'];
const DAY=86400000;
const CATEGORIES=new Set(['fuel','public_transport','topup','ride_hail','charging','unknown','excluded','auto']);
const fail=(code,message,status=400)=>{throw Object.assign(new Error(message),{code,status});};
const now=state=>Date.parse(state.now);
const yuan=value=>`¥${(value/100).toFixed(2)}`;
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
function green(state){state.green??={consent:false,overrides:{},preferences:{}};return state.green;}
function permitted(state){if(state.green?.consent!==true)fail('GREEN_CONSENT_REQUIRED','请先到绿色金融页，自愿授权分析本账户合成流水。',409);}
function positive(value,label){if(!Number.isSafeInteger(value)||value<=0||value>100000000)fail('INVALID_GREEN_AMOUNT',`${label}应为正数，最多精确到分且不超过1,000,000元。`);return value;}
export function setGreenConsent(state,enabled){
  if(typeof enabled!=='boolean')fail('INVALID_GREEN_CONSENT','请明确选择授权或撤回。');
  const g=green(state);g.consent=enabled;
  if(!enabled){
    delete g.chatDraft;
    for(const goal of g.weeklyGoals??[])goal.useBankRecords=false;
    for(const m of state.mandates??[])if(m.scope===GREEN_SCOPE&&['active','paused'].includes(m.status)){m.status='revoked';m.revokedAt=state.now;}
  }
  appendAudit(state,'green_consent',{enabled});
  return {consent:enabled};
}
export function updateGreenPreferences(state,patch){
  permitted(state);
  if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!['maxExtraMinutes','requiredCarDays'].includes(k)))fail('INVALID_GREEN_PREFERENCES','仅支持通勤额外时间与每周必要用车天数。');
  for(const[k,v]of Object.entries(patch))if(!Number.isInteger(v)||v<0||v>(k==='maxExtraMinutes'?120:7))fail('INVALID_GREEN_PREFERENCES','额外时间需为0—120分钟，必要用车需为每周0—7天。');
  green(state).preferences={...(state.green.preferences??{}),...patch};
  appendAudit(state,'green_preferences_updated',patch);return {preferences:structuredClone(state.green.preferences)};
}
export function setGreenOverride(state,transactionId,category){
  permitted(state);
  if(typeof transactionId!=='string'||!state.transactions.some(t=>t.id===transactionId))fail('TRANSACTION_NOT_FOUND','未找到本账户流水。',404);
  if(!CATEGORIES.has(category))fail('INVALID_GREEN_CATEGORY','请选择有效绿色分类。');
  const g=green(state);g.overrides??={};
  if(category==='auto')delete g.overrides[transactionId];else g.overrides[transactionId]=category;
  appendAudit(state,'green_classification_corrected',{transactionId,category});return {transactionId,category};
}

const GREEN_WORDS=/绿色|环保|低碳|节能|通勤|家电换新|7天小目标|交通(?:消费|支出|预算|表现|改善)|(?:加油|地铁).*(?:表现|等级|建议)/;
const QUESTION_OR_NEGATION=/如何|怎么|能否|可否|是否|可以.{0,10}[吗么？?]|如果|假如|不要|不用|不想|不需要|不必|先别|暂不|别帮|先不/;
function numberMoney(text){
  const values=[...text.matchAll(/([+-]?\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千万亿点]+)\s*元/g)].map(m=>parseAmount(m[1]));
  if(!values.length||values.some(v=>!Number.isSafeInteger(v)||v<=0||v>100000000)||new Set(values).size!==1)return undefined;
  return values[0];
}
function watchSlots(text,old={}){
  const result={...old};
  const threshold=numberMoney(text);if(threshold!==undefined)result.thresholdCents=threshold;
  const duration=/(?:有效期|持续|为期|未来|接下来)\s*(\d+)\s*天/.exec(text);
  const interval=/每\s*(\d+)\s*天/.exec(text);
  if(duration)result.durationDays=Number(duration[1]);
  if(interval)result.intervalDays=Number(interval[1]);else if(/每周/.test(text))result.intervalDays=7;
  return result;
}
function liveDraft(state){const d=state.green?.chatDraft;return d&&d.expiresAt>Date.now()?d:null;}
export function parseGreenText(text,state){
  const t=String(text).trim();
  const release=/^(?:请|帮我|麻烦)?\s*(?:释放|取消)(?:这笔)?(?:预算|预留)(?:资金)?\s*(goal-[\w-]+)/.exec(t);
  const draft=liveDraft(state);
  const contextual=draft&&(/\d+\s*(?:元|天|分钟)|原(?:来)?|替代|接送|孩子|必要用车|每天|每月|每周|为什么|原因|等级|表现|依据|建议|数据|本月|上月|下降|提高/.test(t))&&!/转账|给.{0,15}转|生日|申购|赎回|订阅|扣费|理财|基金|密码|银行卡|查.*账单|账户余额/.test(t);
  const monitoring=/交通|通勤|出行/.test(t)&&/监测|关注|盯|提醒/.test(t);
  if(!GREEN_WORDS.test(t)&&!monitoring&&!release&&!contextual)return null;
  const query=()=>({kind:'green_query',slots:{text:t}});
  if(QUESTION_OR_NEGATION.test(t))return query();
  if(release)return {kind:'budget_release',slots:{goalId:release[1]}};
  if(/预留|留出/.test(t)&&GREEN_WORDS.test(t)){
    const amountCents=numberMoney(t);if(amountCents===undefined)return query();
    const purpose=/(?:为|给)\s*(.{1,30}?)(?:预留|留出)/.exec(t)?.[1]??'绿色生活';
    return {kind:'budget_reserve',slots:{amountCents,title:`绿色目标 · ${purpose.replace(/^绿色目标\s*[·：:]?\s*/,'').slice(0,40)}`}};
  }
  if(monitoring||(contextual&&draft.topic==='watch')){
    const slots=watchSlots(t,draft?.topic==='watch'?draft.slots:{});
    if(['thresholdCents','durationDays','intervalDays'].every(k=>Number.isInteger(slots[k])))return {kind:'green_watch_create',slots};
  }
  return query();
}
function comparisonSlots(t,old={}){
  const slots={...old};
  for(const[key,re]of[['originalDaily',/(?:每天)?原(?:来|方案)?(?:每天|费用|日费用|花费|日均)?\s*(\d+(?:\.\d+)?)\s*元/],['alternativeDaily',/(?:替代|新方案|改后|改为)(?:每天|费用|日费用|花费|日均)?\s*(\d+(?:\.\d+)?)\s*元/]]){
    const m=re.exec(t);if(m){const v=Number(m[1])*100;if(Number.isSafeInteger(Math.round(v))&&Math.abs(v-Math.round(v))<1e-6&&v>=0&&v<=100000000)slots[key]=Math.round(v);}
  }
  const days=/每月\s*(\d+)\s*天/.exec(t),extra=/(?:每天)?(?:多花|多用|额外|增加)\s*(\d+)\s*分钟/.exec(t);
  if(days)slots.days=Number(days[1]);if(extra)slots.extraMinutes=Number(extra[1]);
  return slots;
}
export function greenReply(state,intent){
  const text=String(intent.slots.text??''),g=green(state),draft=liveDraft(state);
  if(text.startsWith('绿色选择咨询：')){
    let data;try{data=JSON.parse(text.slice('绿色选择咨询：'.length));}catch{fail('INVALID_GREEN_DECISION','选择信息不完整，请回到绿色页重新计算。');}
    if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!['kind','input','sample'].includes(k))||!['commute','appliance'].includes(data.kind)||(data.sample!==undefined&&typeof data.sample!=='boolean'))fail('INVALID_GREEN_DECISION','选择信息不完整，请回到绿色页重新计算。');
    const result=data.kind==='commute'?calculateCommute(data.input):evaluateAppliance(data.input);
    const detail=data.kind==='commute'?`按${data.input.days}个可替代日，原方案${yuan(result.originalTotalCents)}，替代方案${yuan(result.alternativeTotalCents)}；每天${result.extraTotalMinutes>=0?'多花':'少花'}${Math.abs(result.extraTotalMinutes/data.input.days)}分钟。`:`按${result.years}年比较，继续用旧机的电费${yuan(result.keep.totalCostCents)}；${result.options.map(o=>`${o.name}购机加电费${yuan(o.totalCostCents)}`).join('，')}。`;
    const carbonDetail=result.carbon?(data.kind==='commute'?`按深圳2026年因子，这${data.input.days}天预计${result.carbon.reductionKg>=0?'减排':'增加排放'}${Math.abs(result.carbon.reductionKg).toFixed(2)} kg CO₂。`:`按深圳2026年因子，${result.options.map((o,i)=>`${o.name}每年用电阶段预计${result.carbon.options[i].annualReductionKg>=0?'减排':'增加排放'}${Math.abs(result.carbon.options[i].annualReductionKg).toFixed(2)} kg CO₂`).join('；')}。`):'未提供距离和交通方式，暂不估算减排。';
    return {reply:`${data.sample?'以下含示例输入，仅供体验；请换成自己的报价与用量再决定。\n':''}${result.conclusion}\n${detail}\n${carbonDetail}\n${result.assumptions.join('；')}\n可以回到绿色金融调整条件重新比较。若要安排预算，请另行明确用途与金额，我会生成独立待确认方案，交易密码与设备核验通过后才执行。`,sources:{inputs:data.input,inputSource:data.sample?'sample':'user',...(result.carbon?{carbonSource:result.carbon.source}:{})},trace:['依据输入重新计算，未信任客户端结论','未读取账单，未创建资金或监测计划']};
  }
  if(/7天小目标|绿色行动目标/.test(text)){
    const goal=greenGoals(state).current;
    return {reply:goal?`${goal.title}：${goal.startDate}至${goal.endDate}，已记录${goal.completedDays}/${goal.targetDays}天（自行记录${goal.manualDays}天，公共交通支付线索${goal.bankDays}天，同日去重）。${goal.feedback}可到绿色金融点击日期记录、调整或结束。`:'可以到绿色金融选择公共交通、步行骑行或随手节能，设一个接下来7天的行动天数目标。只记录行动，不预留资金，不扣款。',trace:['读取本账户行动目标，未创建或修改目标及资金计划']};
  }
  if(QUESTION_OR_NEGATION.test(text)&&/预留|留出|监测|委托|释放|预算/.test(text)){
    delete g.chatDraft;return {reply:'可以先讨论方案，不会替你安排。你明确提出监测需求后，会先核对范围、提醒线、期限和间隔；需要预留资金时再生成独立待确认方案，资金操作仍需交易密码和设备验证。暂停提醒不会释放资金。',trace:['咨询或否定表达：未生成任何执行计划']};
  }
  if(/预留|留出/.test(text))return {reply:'请明确要预留的金额与用途，例如“为节能换新预留500元”。预计节省不等于已有资金，确认前不会改变可用余额。',trace:['缺少明确资金参数，未创建计划']};
  if(state.green?.consent===true&&['advice','compare'].includes(draft?.topic)){
    const minutes=/(?:每天|每日).{0,8}?(?:最多|接受|上限)(?:额外|增加|多花|多)?\s*(\d+)\s*分钟/.exec(text);
    const days=/每周\s*(\d+)\s*天.{0,8}(?:用车|开车|接送)/.exec(text);
    const weekdays=new Set([...text.matchAll(/(?:周|星期)([一二三四五六日天])/g)].map(m=>m[1]==='天'?'日':m[1]));
    const patch={};if(minutes)patch.maxExtraMinutes=Number(minutes[1]);if(days)patch.requiredCarDays=Number(days[1]);else if(weekdays.size&&/接送|开车|用车/.test(text))patch.requiredCarDays=weekdays.size;
    if(Object.keys(patch).length){
      updateGreenPreferences(state,patch);g.chatDraft={topic:'compare',slots:draft.topic==='compare'?draft.slots:{},expiresAt:Date.now()+600000};
      return {reply:`已记录你明确提供的生活条件：${patch.maxExtraMinutes!==undefined?`每天额外时间上限${patch.maxExtraMinutes}分钟。`:''}${patch.requiredCarDays!==undefined?`每周${patch.requiredCarDays}天需要用车。`:''}请保留必要用车安排，再提供可替代日的费用：例如“每天原30元、替代8元，每月20天，多花10分钟”。我会核对时间上限，只做情景比较。`,trace:['更新用户明确提供的非金融生活偏好','未创建资金或监测计划']};
    }
  }
  if((/监测|关注|提醒|委托/.test(text)&&/交通|通勤|支出/.test(text))||draft?.topic==='watch'){
    const slots=watchSlots(text,draft?.topic==='watch'?draft.slots:{});
    g.chatDraft={topic:'watch',slots,expiresAt:Date.now()+600000};
    return {reply:`请补充${['thresholdCents','durationDays','intervalDays'].filter(k=>slots[k]===undefined).map(k=>({thresholdCents:'提醒金额（元）',durationDays:'有效期（天）',intervalDays:'检查间隔（天）'}[k])).join('、')||'完整监测条件'}。例如“关注交通支出，超过600元提醒，有效期30天，每7天检查”。只观察创建后可识别交通消费，不含交通卡充值、无法识别记录；不会扣款或限制用卡。`,trace:['仅补充委托条件，尚未创建委托']};
  }
  if(/家电|换新|耗电/.test(text)&&!/通勤/.test(text))return {reply:'可以先比较“继续使用”与“换新”的总成本。打开绿色金融的“换新值不值”，输入旧机年耗电量、新机到手价与年耗电量、电价、打算使用年限；旧机坏了可选必须换新，再对比两款报价。无需授权账单，不会套用未经核实的补贴或估算真实减排。',trace:['换新咨询：未读取账单、未创建计划']};
  if(/比较|方案|原(?:来)?\s*\d|替代/.test(text)||draft?.topic==='compare'){
    const slots=comparisonSlots(text,draft?.topic==='compare'?draft.slots:{});
    if(!['originalDaily','alternativeDaily','days','extraMinutes'].every(k=>Number.isInteger(slots[k]))){
      g.chatDraft={topic:'compare',slots,expiresAt:Date.now()+600000};
      return {reply:'我会先按你提供的费用和时间比较，不猜路线或实时票价。请补充：每天原费用、替代日费用、每月可替代天数、每天额外耗时。例如“每天原30元、替代8元，每月20天，多花10分钟”。接送家人等必要用车安排请保留，只计算你认为可替代的天数。',trace:['比较信息不足，未估算减排或安排业务']};
    }
    if(slots.days<1||slots.days>31||slots.extraMinutes<0||slots.extraMinutes>240)fail('INVALID_GREEN_COMPARISON','可替代天数需1—31天，额外耗时需0—240分钟。');
    g.chatDraft={topic:'compare',slots,expiresAt:Date.now()+600000};
    const max=g.preferences?.maxExtraMinutes;
    const result=calculateCommute({originalDailyCents:slots.originalDaily,alternativeDailyCents:slots.alternativeDaily,days:slots.days,extraMinutes:slots.extraMinutes,...(max!==undefined?{maxExtraMinutes:max}:{})});
    const original=result.originalTotalCents,alternative=result.alternativeTotalCents,difference=result.differenceCents;
    const constraint=max!==undefined&&slots.extraMinutes>max?`额外${slots.extraMinutes}分钟超过你设置的${max}分钟上限，这个方案不适合直接采用，建议减少替代天数或换一种方式。`:`每天额外${slots.extraMinutes}分钟${max!==undefined?`，在你设置的${max}分钟上限内`: '；请核对能否接受'}。`;
    return {reply:`按你提供的${slots.days}个可替代日，原方案${yuan(original)}，替代方案${yuan(alternative)}，预计${difference>=0?'少支出':'多支出'}${yuan(Math.abs(difference))}。${constraint}这只比较你给定的情景，不含未提供的停车、换乘等成本；预计差额没有进入账户。缺少距离与适用方法参数，不估算碳减排量。必要用车应保留，结果不代表必须改换。`,sources:{inputs:slots},trace:['按用户明确输入计算情景费用与时间','没有创建资金或委托计划']};
  }
  if(state.green?.consent!==true)return {reply:'换新与通勤比较、小目标可以直接使用，不必授权账单。若要分析交通消费，请到绿色金融页底自愿开启“消费表现与依据”。',trace:['未授权：未分析流水、未创建计划']};
  const monthMatch=/(20\d{2})[-年](\d{1,2})(?:月)?/.exec(text);
  let month=monthMatch?`${monthMatch[1]}-${monthMatch[2].padStart(2,'0')}`:draft?.slots?.month;
  if(/本月/.test(text))month=undefined;
  if(/上(?:个)?月/.test(text)){
    const ref=month??new Date(now(state)+8*3600000).toISOString().slice(0,7),[year,mo]=ref.split('-').map(Number);month=new Date(Date.UTC(year,mo-2,1)).toISOString().slice(0,7);
  }
  const report=greenReport(state,month);
  g.chatDraft={topic:'advice',slots:{month:report.month},expiresAt:Date.now()+600000};
  return {reply:`${report.month}：${report.level.label}。${report.level.reason}\n${report.coverage.note}\n${report.suggestions.map(s=>`${s.title}：${s.detail}`).join('\n')}\n可以告诉我每天最多接受增加多少通勤时间、哪些日子必须用车，我再帮你比较可行的改善方式。评级只反映已识别交通支付；不代表完整碳足迹或信用评分。`,sources:{transactionIds:report.evidence.map(e=>e.transactionId),asOf:state.now},trace:['读取已授权的本账户交通消费','使用公开的项目评级规则，不推断里程或官方碳资产','未创建任何执行计划']};
}

export function normalizeGreenStep(state,intent){
  if(!GREEN_WRITE_KINDS.includes(intent.kind))return null;
  const p=intent.slots??{};
  if(intent.kind==='budget_release'){
    if(Object.keys(p).some(k=>!['goalId','amountCents'].includes(k)))fail('INVALID_GOAL','预算释放包含未开放字段。');
    const goal=state.goals.find(g=>g.id===p.goalId&&g.type==='reserve');
    if(!goal)fail('GOAL_NOT_FOUND','没有找到本账户的通用预留目标；生日预约请在预约中撤销。',404);
    if(goal.status!=='reserved')fail('GOAL_NOT_RESERVED','此预算已释放或不处于预留状态。',409);
    positive(goal.amountCents,'预留金额');
    if(p.amountCents!==undefined&&p.amountCents!==goal.amountCents)fail('GOAL_CHANGED','预留金额已变化，请重新核对。',409);
    if(goal.amountCents>state.account.reservedCents)fail('RESERVATION_MISSING','账户预留状态不一致，未释放资金。',409);
    return {step:{tool:intent.kind,params:{goalId:goal.id,amountCents:goal.amountCents},label:`释放「${goal.title}」预留 ${yuan(goal.amountCents)}`},impactCents:0,warnings:['增加可用余额，总余额保持；不产生退款或新增收入。']};
  }
  permitted(state);
  if(Object.keys(p).some(k=>!['thresholdCents','durationDays','intervalDays'].includes(k)))fail('INVALID_GREEN_WATCH','监测包含未开放字段。');
  positive(p.thresholdCents,'提醒金额');
  if(!Number.isInteger(p.durationDays)||p.durationDays<1||p.durationDays>90||!Number.isInteger(p.intervalDays)||p.intervalDays<1||p.intervalDays>30||p.intervalDays>p.durationDays)fail('INVALID_GREEN_WATCH','有效期1—90天，检查间隔1—30天且不得长于有效期。');
  if((state.mandates??[]).some(m=>m.scope===GREEN_SCOPE&&['active','paused'].includes(m.status)&&Date.parse(m.expiresAt)>now(state)))fail('GREEN_WATCH_EXISTS','已有有效交通委托，请先到预约与凭证查看、修改或撤销。',409);
  return {step:{tool:intent.kind,params:{thresholdCents:p.thresholdCents,durationDays:p.durationDays,intervalDays:p.intervalDays},label:`交通消费观察：创建后累计达到${yuan(p.thresholdCents)}提醒，有效${p.durationDays}天，每${p.intervalDays}天检查`},impactCents:0,warnings:['仅统计创建后的可识别交通消费，不含充值和未知记录；不是自然月预算。','只产生站内提醒，不扣款、不锁卡、不发送家庭风险提醒。检查依赖页面请求或演示时钟推进。']};
}
export function applyGreenStep(state,step){
  const normalized=normalizeGreenStep(state,{kind:step.tool,slots:step.params});
  if(!normalized)fail('UNKNOWN_TOOL','不支持此绿色业务操作。');
  const p=normalized.step.params;
  if(step.tool==='budget_release'){
    const goal=state.goals.find(g=>g.id===p.goalId);state.account.reservedCents-=p.amountCents;goal.status='released';goal.releasedAt=state.now;
    appendAudit(state,'budget_released',{goalId:goal.id,amountCents:p.amountCents});
  }else{
    state.mandates??=[];
    state.mandates.push({id:`mandate-${randomUUID()}`,title:'交通消费观察',scope:GREEN_SCOPE,status:'active',...p,excludedSubscriptionIds:[],baselineIds:state.transactions.map(t=>t.id),createdAt:state.now,expiresAt:new Date(now(state)+p.durationDays*DAY).toISOString(),nextRunAt:new Date(now(state)+p.intervalDays*DAY).toISOString(),runs:[]});
    if(state.green)delete state.green.chatDraft;
    appendAudit(state,'green_watch_created',p);
  }
  return [];
}
export function runGreenWatches(state,{force=false}={}){
  const runs=[];let notificationsCreated=0;
  for(const m of state.mandates??[]){
    if(m.scope!==GREEN_SCOPE)continue;
    if(state.green?.consent!==true&&['active','paused'].includes(m.status)){m.status='revoked';continue;}
    if(['active','paused'].includes(m.status)&&now(state)>=Date.parse(m.expiresAt))m.status='expired';
    if(m.status!=='active'||(!force&&now(state)<Date.parse(m.nextRunAt)))continue;
    const baseline=new Set(m.baselineIds??[]),found=new Map();
    const start=new Date(Date.parse(m.createdAt)+8*3600000),end=new Date(Math.min(now(state),Date.parse(m.expiresAt))+8*3600000);
    for(let y=start.getUTCFullYear(),mo=start.getUTCMonth();y<end.getUTCFullYear()||(y===end.getUTCFullYear()&&mo<=end.getUTCMonth());){
      const month=`${y}-${String(mo+1).padStart(2,'0')}`;
      for(const e of greenReport(state,month).evidence){
        const at=Date.parse(e.date);
        if(e.rated&&!baseline.has(e.transactionId)&&at>=Date.parse(m.createdAt)&&at<=now(state)&&at<Date.parse(m.expiresAt))found.set(e.transactionId,e);
      }
      if(++mo===12){mo=0;y++;}
    }
    const total=[...found.values()].reduce((n,e)=>n+Math.abs(e.amountCents),0),key=`green-budget:${m.id}`;
    state.notifications??=[];
    const already=state.notifications.some(n=>n.dedupeKey===key);
    if(total>=m.thresholdCents&&!already&&!m.thresholdNotified){
      state.notifications.push({id:`ntf-${randomUUID()}`,read:false,kind:'green_budget',mandateId:m.id,at:state.now,title:'交通消费达到你设置的观察线',body:`创建后可识别交通消费累计${yuan(total)}，观察线${yuan(m.thresholdCents)}。不含充值及未知记录。这是预算观察，非资金安全警报；没有扣款或限制用卡。`,dedupeKey:key,transactionIds:[...found.keys()]});
      m.thresholdNotified=true;notificationsCreated++;
      if(state.notifications.length>200)state.notifications.splice(0,state.notifications.length-200);
    }
    const entry={at:state.now,scope:GREEN_SCOPE,checked:found.size,findings:total>=m.thresholdCents&&!already?1:0,note:`累计可识别交通消费${yuan(total)}；未执行资金操作。`};
    m.runs??=[];m.runs.push(entry);if(m.runs.length>20)m.runs.splice(0,m.runs.length-20);
    m.lastRunAt=state.now;m.nextRunAt=new Date(now(state)+m.intervalDays*DAY).toISOString();runs.push({...entry,mandateId:m.id});
  }
  return {runs,notificationsCreated};
}
