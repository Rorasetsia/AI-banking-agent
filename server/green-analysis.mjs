export const GREEN_SCOPE='green_transport_watch';
export const GREEN_VERSION='green-v1';
export const GREEN_CATEGORIES=['fuel','public_transport','topup','ride_hail','charging','unknown','excluded'];
const CATS=new Set(GREEN_CATEGORIES),HOUR=3600000;
const RATED=new Set(['fuel','public_transport','ride_hail','charging']);
const CONSUMPTION=new Set(['expense','payment','consumption','subscription']);
const isoDay=value=>new Date(Date.parse(value)+8*HOUR).toISOString().slice(0,10);
const blankStats=()=>({totalCents:0,counts:Object.fromEntries(GREEN_CATEGORIES.map(c=>[c,0])),amounts:Object.fromEntries(GREEN_CATEGORIES.map(c=>[c,0])),publicShare:null});
function previousMonth(month){const[y,m]=month.split('-').map(Number),d=new Date(Date.UTC(y,m-2,1));return d.toISOString().slice(0,7);}
function start(month){const[y,m]=month.split('-').map(Number);return Date.UTC(y,m-1,1)-8*HOUR;}
function end(month){const[y,m]=month.split('-').map(Number);return Date.UTC(y,m,1)-8*HOUR;}
function classify(tx){
  const t=`${tx.merchant??''} ${tx.category??''} ${tx.memo??''}`;
  if(/(?:交通卡|深圳通|公交卡|地铁卡|羊城通).*(?:充值|储值)|(?:充值|储值).*(?:交通卡|公交|地铁)/.test(t))return ['topup','交通储值线索；充值不等于一次乘车。'];
  if(/地铁|公交|轨道交通|公共汽车/.test(t))return ['public_transport','存在公共交通支付线索；票价不直接代表里程或行程次数。'];
  if(/加油|中国石化|中石化|中国石油|中石油|汽油|柴油/.test(t))return ['fuel','存在燃油相关消费；加油金额不等于当期用油量。'];
  if(/充电|特来电|星星充电/.test(t))return ['charging','存在充电消费；不直接视为零排放。'];
  if(/滴滴|网约车|打车|出租车|曹操出行|高德打车/.test(t))return ['ride_hail','网约车或出租车消费；车型与能源类型未知。'];
  return ['unknown','缺少足以判断绿色行为的明细，不强行归类。'];
}
function period(state,from,to){
  const ids=new Set(),rows=[],refunded=new Set();
  for(const t of state.transactions??[]){
    if(t.amountCents<=0||!Number.isSafeInteger(t.amountCents)||!Number.isFinite(Date.parse(t.date))||Date.parse(t.date)>Math.min(Date.parse(state.now),to-1))continue;
    if(typeof t.refundOf==='string')refunded.add(t.refundOf);
    else if(t.kind==='refund'||/退款|退回/.test(t.memo??''))for(const original of state.transactions??[])if(typeof original.id==='string'&&String(t.memo??'').includes(original.id))refunded.add(original.id);
  }
  for(const t of state.transactions??[]){
    if(typeof t.id!=='string'||ids.has(t.id))continue;ids.add(t.id);
    const at=Date.parse(t.date);
    if(!Number.isFinite(at)||at<from||at>=to||!Number.isSafeInteger(t.amountCents)||t.amountCents>=0||!CONSUMPTION.has(t.kind))continue;
    rows.push(t);
  }
  const groups=new Map();
  for(const t of rows){const key=JSON.stringify([t.merchant,t.amountCents,isoDay(t.date)]);groups.set(key,(groups.get(key)??0)+1);}
  const stats=blankStats(),evidence=[],days=new Set();let ratedCount=0,excludedCount=0,recognizedCount=0;
  for(const t of rows){
    const duplicate=groups.get(JSON.stringify([t.merchant,t.amountCents,isoDay(t.date)]))>1;
    const override=state.green?.overrides?.[t.id];
    let[category,reason]=classify(t),source='rule';
    if(CATS.has(override)){category=override;source='user';reason='由你纠正的绿色分类，尚未经外部平台核实。';}
    const isTransport=category!=='unknown'||/交通|出行|通勤|乘车|深圳通/.test(`${t.category} ${t.merchant} ${t.memo}`)||CATS.has(override);
    if(!isTransport)continue;
    if(refunded.has(t.id)){category='excluded';reason='存在明确关联退款，本次分析剔除原消费。';}
    else if(duplicate){category='excluded';reason='同商户、同金额、同日出现多条，待核查前从评级和汇总中剔除。';}
    const rated=RATED.has(category);
    stats.counts[category]++;
    if(category==='excluded')excludedCount++;
    else if(category!=='unknown'){
      stats.amounts[category]+=Math.abs(t.amountCents);stats.totalCents+=Math.abs(t.amountCents);recognizedCount++;
    }
    if(rated){ratedCount++;days.add(isoDay(t.date));}
    evidence.push({transactionId:t.id,date:t.date,merchant:String(t.merchant??''),amountCents:t.amountCents,category,reason,source,rated});
  }
  stats.publicShare=ratedCount?stats.counts.public_transport/ratedCount:null;
  evidence.sort((a,b)=>b.date.localeCompare(a.date));
  return {stats,evidence,eligibleCount:rows.length,ratedCount,distinctDays:days.size,excludedCount,recognizedCount};
}
export function greenReport(state,month){
  const ref=Date.parse(state.now);
  if(!Number.isFinite(ref))throw Object.assign(new Error('沙箱时钟无效。'),{status:500,code:'INVALID_CLOCK'});
  const local=new Date(ref+8*HOUR),currentMonth=local.toISOString().slice(0,7);
  month??=currentMonth;
  if(typeof month!=='string'||!/^20\d\d-(0[1-9]|1[0-2])$/.test(month)||month>currentMonth)throw Object.assign(new Error('请选择有效且不晚于沙箱时钟的月份。'),{status:400,code:'INVALID_GREEN_MONTH'});
  const prev=previousMonth(month);
  const report={consent:state.green?.consent===true,version:GREEN_VERSION,month,previousMonth:prev,
    level:{code:'insufficient',label:'暂不足以评估',reason:'需要更多可识别交通支付记录，数据缺失不代表最环保。'},
    coverage:{eligibleCount:0,recognizedCount:0,ratedCount:0,distinctDays:0,excludedCount:0,note:'尚未授权，不读取或展示绿色消费分析。'},
    current:blankStats(),previous:blankStats(),evidence:[],suggestions:[],
    trend:{comparable:false,expenseDifferenceCents:null,publicShareDifference:null,note:'数据不足，暂不比较。'},
    limitations:['只覆盖本账户已授权的合成记录，不包含现金和其他支付渠道。','评级对象为已识别交通支付，不等于行程次数、完整碳足迹或个人信用。','缺少距离、用量和适用参数，不估算碳减排公斤数，不产生官方碳资产。'],
    rules:['项目规则 green-v1：至少5条可评级交通支付，且跨3个上海日期。','公共交通笔数占比 = 公共交通支付 /（公共交通+燃油+网约车+充电支付）；充值、未知及剔除记录不入分母。','占比低于30%为起步中，30%至不足60%为持续践行，60%及以上为较积极；阈值为项目演示设定，非官方标准。','疑似重复和明确关联退款剔除，人工分类标注来源；不同支付习惯会影响结果，不能用于人与人排名。'],
    preferences:{},activeWatches:[],goals:[]};
  if(!report.consent)return report;
  let until=end(month),prevUntil=end(prev);
  if(month===currentMonth){
    until=ref+1;
    const[y,m]=prev.split('-').map(Number),last=new Date(Date.UTC(y,m,0)).getUTCDate();
    prevUntil=Date.UTC(y,m-1,Math.min(local.getUTCDate(),last),local.getUTCHours(),local.getUTCMinutes(),local.getUTCSeconds(),local.getUTCMilliseconds())-8*HOUR+1;
  }
  const a=period(state,start(month),until),b=period(state,start(prev),prevUntil);
  report.current=a.stats;report.previous=b.stats;report.evidence=a.evidence;
  report.coverage={eligibleCount:a.eligibleCount,recognizedCount:a.recognizedCount,ratedCount:a.ratedCount,distinctDays:a.distinctDays,excludedCount:a.excludedCount,note:`本期可分析消费${a.eligibleCount}条，识别交通支付${a.recognizedCount}条，其中${a.ratedCount}条用于评级、跨${a.distinctDays}个日期。未识别记录和其他支付渠道不视为绿色行为。`};
  if(a.ratedCount>=5&&a.distinctDays>=3){
    const share=a.stats.publicShare;
    report.level={code:share<.3?'starting':share<.6?'steady':'active',label:share<.3?'起步中':share<.6?'持续践行':'较积极',reason:`已识别交通支付的低碳倾向：公共交通支付笔数占可评级样本${Math.round(share*100)}%；不表示实际出行里程占比。`};
  }
  const comparable=a.ratedCount>=5&&a.distinctDays>=3&&b.ratedCount>=5&&b.distinctDays>=3;
  report.trend={comparable,expenseDifferenceCents:comparable?a.stats.totalCents-b.stats.totalCents:null,publicShareDifference:comparable?a.stats.publicShare-b.stats.publicShare:null,note:`${month===currentMonth?'按上月相同月内日期和上海时刻对照':'按完整历史月份对照'}。${comparable?'金额变化不代表由建议带来的节约，也不增加账户余额。':'两期均达到样本门槛后才展示变化数值。'}`};
  report.preferences={...(state.green.preferences??{})};
  if(a.ratedCount<5||a.distinctDays<3)report.suggestions.push({id:'coverage',title:'先补全信息，再看变化',detail:'当前样本较少，可以先了解已有记录；不要为了提高等级新增消费。',question:`分析${month}的绿色消费表现，并说明数据缺口`});
  if(a.stats.counts.fuel||a.stats.counts.ride_hail)report.suggestions.push({id:'commute',title:'保留必要用车，比较可替代行程',detail:report.preferences.requiredCarDays!==undefined?`你每周有${report.preferences.requiredCarDays}天需要用车；先保留这些安排，再比较其余行程。`:'接送家人、夜间安全和工作需求应优先考虑，先确认哪些行程可以调整。',question:'帮我比较通勤改善方案，先问清必要用车和时间限制'});
  else report.suggestions.push({id:'compare',title:'找到适合自己的通勤方式',detail:'可以比较可替代日的费用与额外时间，先补充条件，再决定是否改变。',question:'比较我的通勤方案，需要我补充哪些信息？'});
  if(a.stats.counts.topup||a.stats.counts.unknown)report.suggestions.push({id:'evidence',title:'有些记录还不能说明出行方式',detail:'充值不算乘车，未知记录不强行归类；展开依据后可纠正绿色分类。',question:'解释绿色评级中充值和未知记录为什么没有计入'});
  else report.suggestions.push({id:'limits',title:'低碳选择也要符合你的生活',detail:report.preferences.maxExtraMinutes!==undefined?`比较方案时会核对每天额外${report.preferences.maxExtraMinutes}分钟的可接受上限。`:'告诉助手每天能接受增加多少时间，避免只看费用而忽略生活安排。',question:'帮我分析适合自己的绿色出行建议'});
  report.suggestions=report.suggestions.slice(0,3);
  report.activeWatches=(state.mandates??[]).filter(m=>m.scope===GREEN_SCOPE&&['active','paused'].includes(m.status)&&Date.parse(m.expiresAt)>ref).map(({id,title,status,expiresAt})=>({id,title,status,expiresAt}));
  report.goals=(state.goals??[]).filter(g=>g.type==='reserve'&&g.status==='reserved'&&/绿色|节能|低碳/.test(g.title??'')).map(({id,title,amountCents,status})=>({id,title,amountCents,status}));
  return report;
}
