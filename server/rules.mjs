const kinds = new Set(['transfer','aa_request','schedule_transfer','cancel_schedule','analytics','wealth_compare','wealth_buy','wealth_redeem','subscription_list','subscription_cancel','card_list','card_apply','card_limit','card_lock','card_unlock','card_loss','budget_reserve','event_plan','account','help','clarify','refuse','composite']);
export { kinds };
kinds.add('own_deposit');kinds.add('own_withdraw');
kinds.add('schedule_reauthorize');
kinds.add('savings_plan');kinds.add('agent_overview');
export const RULE_INPUT = Symbol('trusted-rule-input');
export const unsafe = text => /(?:忽略|绕过|跳过|不必|无需|不要|不用).{0,8}(?:确认|规则|权限|安全)|(?:泄露|显示|输出|给我).{0,8}(?:密钥|系统提示|系统指令|api.?key)|执行\s*(?:SQL|代码)|你现在是系统|system\s*prompt/i.test(text);

function chineseNumber(raw) {
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  if (/[百千万亿][一二两三四五六七八九]$/.test(raw)) return NaN;
  const digits = {零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
  const units = {十:10,百:100,千:1000,万:10000,亿:100000000};
  if (raw.includes('点')) { const [a,b] = raw.split('点'); return chineseNumber(a) + Number(`0.${[...b].map(c=>digits[c]??c).join('')}`); }
  let result=0,section=0,current=0;
  for (const c of raw) {
    if (c in digits) { current=digits[c]; continue; }
    const unit=units[c]; if (!unit) return NaN;
    if (unit>=10000) { section+=current; result+=(section||1)*unit; section=0; current=0; }
    else { section+=(current||1)*unit; current=0; }
  }
  return result+section+current;
}
export function parseAmount(raw) {
  const text=String(raw).trim().replace(/,/g,'');
  const m=/^([+-]?\d+(?:\.\d+)?)(万|千|百|亿|[wk])?$/i.exec(text);
  let n=m?Number(m[1])*({万:10000,千:1000,百:100,亿:1e8,w:10000,k:1000}[m[2]?.toLowerCase()]??1):chineseNumber(text);
  const cents=Math.round(n*100);
  return Number.isFinite(n)&&Number.isSafeInteger(cents)&&Math.abs(n*100-cents)<0.0001?cents:undefined;
}
const numeric='(?:-?\\d+(?:\\.\\d+)?(?:万|千|百|亿|[wk])?|[零〇一二两三四五六七八九十百千万亿点]+)';
const stripMemo=text=>text.replace(/(?:备注|附言)[^，,；;。]*/g,'').trim();
function amount(text) {
  text=stripMemo(text);
  if(new RegExp(`(${numeric})\\s*(?:元|块)?\\s*(?:或|还是)\\s*(${numeric})`).test(text))return undefined;
  const matches=[...text.matchAll(new RegExp(`(${numeric})\\s*(?:元|块|人民币)(?:\\s*([一二两三四五六七八九零\\d])(?:角|毛))?(?:\\s*([一二两三四五六七八九零\\d])分)?`, 'gi'))];
  const values=matches.map(m=>{const major=parseAmount(m[1]);return major===undefined?undefined:major+(m[2]?chineseNumber(m[2])*10:0)+(m[3]?chineseNumber(m[3]):0);});
  if(values.length)return new Set(values).size===1?values[0]:undefined;
  const cleaned=text.replace(/1[3-9]\d{9}/g,'').replace(/\d{4}-\d\d-\d\d[^，。\s]*/g,'').replace(/\d+月\d+日|\d+[点时天日月年]/g,'');
  const n=new RegExp(`(?:转账?|汇款?|购买|买入|申购|预留|锁定|调到|调整到|设置为|金额|总额)\\s*(${numeric})(?![\\d份人])`,'i').exec(cleaned);
  if(n)return parseAmount(n[1]);
  const tail=new RegExp(`(${numeric})\\s*$`,'i').exec(cleaned);
  return tail?parseAmount(tail[1]):undefined;
}
const has=(text,pattern)=>pattern.test(text);
const localParts=now=>new Date(new Date(now).getTime()+8*3600000).toISOString();
export function dateFor(text,state,birthday=false) {
  const full=/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})/.exec(text);
  if(full&&!birthday)return full[0];
  const today=localParts(state.now),y=Number(today.slice(0,4)),m=Number(today.slice(5,7)),d=Number(today.slice(8,10));
  let date;
  const explicit=/(\d{4})[-年](\d{1,2})[-月](\d{1,2})(?:日|号)?/.exec(text);
  const md=/(\d{1,2})月(\d{1,2})(?:日|号)/.exec(text);
  if(explicit)date=[Number(explicit[1]),Number(explicit[2]),Number(explicit[3])];
  else if(md)date=[y,Number(md[1]),Number(md[2])];
  else if(/明天|后天|今天/.test(text)) {
    const delta=text.includes('后天')?2:text.includes('明天')?1:0;
    const dt=new Date(Date.UTC(y,m-1,d+delta));date=[dt.getUTCFullYear(),dt.getUTCMonth()+1,dt.getUTCDate()];
  } else {const next=/下月(\d{1,2})(?:日|号)/.exec(text);if(next){const dt=new Date(Date.UTC(y,m,1));date=[dt.getUTCFullYear(),dt.getUTCMonth()+1,Number(next[1])];}}
  if(!date)return undefined;
  const [yy,mm,dd]=date;
  const dt=new Date(Date.UTC(yy,mm-1,dd));
  if(dt.getUTCMonth()+1!==mm||dt.getUTCDate()!==dd)return 'invalid-date';
  const day=`${yy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
  if(birthday)return day;
  const time=/(?:(\d{1,2})[:：](\d{2})|(\d{1,2})(?:点|时)(半|\d{1,2}分)?)/.exec(text);
  let hour=time?Number(time[1]??time[3]):9;
  if(/下午|晚上/.test(text)&&hour<12)hour+=12;
  const minute=time?Number(time[2]??(time[4]==='半'?30:time[4]?.replace('分','')??0)):0;
  if(hour>23||minute>59)return 'invalid-date';
  return `${day}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00+08:00`;
}
export function parseRules(input,state) {
  let text=String(input??'').trim();
  const original=text;
  const out=(kind,slots={})=>Object.defineProperty({kind,slots:Object.fromEntries(Object.entries(slots).filter(([,v])=>v!==undefined))},RULE_INPUT,{value:original});
  if(unsafe(text))return out('refuse',{reason:'不能绕过确认、权限校验或披露系统凭据。请直接描述需要办理的银行业务。'});
  if(!text||text.length>2000)return out('clarify',{question:'请用2000字以内描述一项银行业务。'});
  text=stripMemo(text);
  if(/^(取消|算了|不用了|重新开始)$/.test(text))return out('refuse',{reason:'已停止本次追问；已有待确认计划仍可在“预约与凭证”单独取消。'});
  const parts=text.split(/并且|然后|并(?=(?:给|将|把|锁定|取消|购买|挂失))/).map(s=>s.trim()).filter(Boolean);
  if(parts.length>1&&parts.length<=5){const actions=parts.map(p=>parseRules(p,state));if(actions.every(a=>!['clarify','help','analytics','account','wealth_compare','composite'].includes(a.kind)))return out('composite',{actions});}
  const value=amount(text);
  if(/重新授权预约/.test(text))return out('schedule_reauthorize',{scheduleId:text.match(/schedule-[a-zA-Z0-9-]+/)?.[0]});
  if((/存入|充值|转出|提现/.test(text)||(/本人|自己|我名下|另一张|其他卡|他行卡/.test(text)&&/转入|转到|转回/.test(text)))&&!/申购|赎回/.test(text)){
    const tail=/(?:尾号|卡号)\s*(\d{4})(?!\d)/.exec(text)?.[1];
    const ownCard=state.ownCards?.find(c=>(tail&&c.last4===tail)||text.includes(c.id));
    return out(/存入|充值|转入/.test(text)?'own_deposit':'own_withdraw',{ownCardId:ownCard?.id,amountCents:value});
  }
  const cardName=text.includes('信用')?'信用卡':/借记|储蓄/.test(text)?'借记卡':undefined;
  const cardTail=/(?:尾号|卡号)\s*(\d{4})(?!\d)/.exec(text)?.[1];
  const cardId=state.cards?.find(c=>text.includes(c.id)||(cardTail&&c.last4===cardTail))?.id;
  const product=state.products?.find(p=>text.includes(p.name)||text.includes(p.id));
  if(/生日|纪念日/.test(text)&&/提醒|订购|鲜花|蛋糕|预留|锁定/.test(text))return out('event_plan',{eventDate:dateFor(text,state,true),budgetCents:value,daysBefore:Number(/提前\s*(\d+)\s*天/.exec(text)?.[1]??2),title:'爱人生日 · 鲜花与蛋糕'});
  if(/取消|撤销/.test(text)&&/预约|定时|任务/.test(text))return out('cancel_schedule',{scheduleId:text.match(/(?:schedule|sch|task)[-_][a-zA-Z0-9-]+/)?.[0]??(state.schedules?.filter(t=>t.status==='scheduled').length===1?state.schedules?.find(t=>t.status==='scheduled')?.id:undefined)});
  if(/AA|平摊|均摊|分摊/i.test(text)){const raw=/(\d+|[二两三四五六七八九十]+)\s*个?人/.exec(text)?.[1];return out('aa_request',{totalCents:value,participants:raw?chineseNumber(raw):undefined,title:'AA收款'});}
  if(/取消|关闭|停止/.test(text)&&/订阅|代扣|会员|续费|云盘|云空间/.test(text)){const sub=state.subscriptions?.find(s=>text.includes(s.id)||text.includes(s.name));return out('subscription_cancel',{subscriptionId:sub?.id,subscriptionName:sub?.name??text.replace(/取消|关闭|停止|自动续费|订阅|代扣|的|\s/g,'')});}
  if(/订阅|代扣|续费|会员|自动扣款/.test(text))return out('subscription_list');
  if(/赎回|卖出理财/.test(text))return out('wealth_redeem',{productId:product?.id,productName:product?.name,shares:Number(/(\d+)\s*份/.exec(text)?.[1])||undefined});
  if(/申购|买入|购买|买/.test(text)&&(product||/理财|基金/.test(text)))return out('wealth_buy',{productId:product?.id,productName:product?.name,amountCents:value,cardId:cardId&&state.cards?.find(c=>c.id===cardId||c.last4===cardTail)?.id});
  if(/理财|风险评估|风险测评|产品对比|产品比较/.test(text))return out('wealth_compare');
  if(/申请/.test(text)&&/卡/.test(text))return out('card_apply',{cardName:cardName??'信用卡'});
  if(/挂失/.test(text))return out('card_loss',{cardId,cardName});
  if(/解锁|解除限制|恢复交易/.test(text))return out('card_unlock',{cardId,cardName});
  if(/锁定|冻结|限制交易|暂停交易/.test(text)&&/卡/.test(text))return out('card_lock',{cardId,cardName});
  if(/额度|限额/.test(text)&&/调|设|改|提高|降低/.test(text))return out('card_limit',{cardId,cardName,limitCents:value});
  if(/银行卡|卡片|我的卡/.test(text))return out('card_list');
  if(/预留|锁定/.test(text)&&/预算|资金|活期|元|块/.test(text))return out('budget_reserve',{amountCents:value,title:text.replace(/\d+(?:\.\d+)?\s*元/,'').slice(0,50)});
  if(/转账|转给|转\s*(?:\d|[零一二两三四五六七八九十])|汇款|汇给|打款|给.+(?:转|打)/.test(text)) {
    const phone=/1[3-9]\d{9}/.exec(text)?.[0];
    const name=/(?:给|向)(.+?)(?:转账?|汇款?|打款?|打)/.exec(text)?.[1]?.trim()??/(?:转(?:账)?|汇)给([^\d，。\s]+?)(?=\d|[零一二两三四五六七八九十]|$)/.exec(text)?.[1];
    const recipient=name??phone;
    const executeAt=dateFor(text,state);
    const memo=/(?:备注|附言)[为是:：\s]*([^，,；;。]+)/.exec(original)?.[1]?.slice(0,120);
    return out(executeAt?'schedule_transfer':'transfer',{recipient,amountCents:value,memo,executeAt});
  }
  if(/账单|消费|支出|月报|年报|流水|花了|花钱/.test(text)) {
    const yearText=/(20\d{2})年/.exec(text)?.[1],monthText=/(20\d{2})年(\d{1,2})月/.exec(text);
    const period=/年度|全年|年报|今年|\d{4}年(?!\d{1,2}月)/.test(text)?'year':'month';
    let month=monthText?`${monthText[1]}-${monthText[2].padStart(2,'0')}`:text.match(/20\d{2}-(?:0[1-9]|1[0-2])/)?.[0];
    if(/上月/.test(text)){const dt=new Date(localParts(state.now));dt.setUTCDate(1);dt.setUTCMonth(dt.getUTCMonth()-1);month=dt.toISOString().slice(0,7);}
    const category=['餐饮','交通','购物','居住','娱乐','转账','理财'].find(c=>text.includes(c));
    return out('analytics',{period,year:yearText?Number(yearText):undefined,month,category});
  }
  if(/余额|资产|可用资金|账户|还剩/.test(text))return out('account');
  if(/帮助|能做什么|你好|功能/.test(text))return out('help');
  return out('clarify',{question:original});
}
export { amount as extractAmount };
