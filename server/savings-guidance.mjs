const money = n => new Intl.NumberFormat('zh-CN', {style:'currency',currency:'CNY'}).format(n/100);
export function readSavingsConstraints(text, previous={}) {
  const next={...previous};let changed=false;
  const set=(key,value)=>{next[key]=value;changed=true;};
  if(/不能延期|不可延期|不能延后|不接受延期|期限(?:也)?不变|期限(?:也)?不能(?:延后|调整)|必须按时|不能推迟/.test(text))set('keepDeadline',true);
  if(/(?:目标(?:金额)?|金额)(?:也)?(?:不能|不可)(?:降低|调整)|目标(?:金额)?(?:也)?不变|至少攒够/.test(text))set('keepTarget',true);
  if(/(?:期限|日期)(?:也)?可以调整|可以延期|可以延后|不必按时/.test(text))set('keepDeadline',false);
  if(/目标(?:金额)?(?:也)?可以调整|可以降低目标|目标(?:金额)?可以降低/.test(text))set('keepTarget',false);
  return changed?next:null;
}

// Explain verified projections; these proposals never change a budget or move funds.
export function buildSavingsGuidance(s, actions=[], constraints={}) {
  const has=id=>actions.some(a=>a.id===id);
  const edit={id:'edit',kind:'edit',title:'重新核对条件',reason:'如果收入、支出或目标有变化，先更新条件，再重新计算。',tradeoff:'新的金额仍需你确认，不会自动执行。'};
  const bills={id:'cashflow',title:'先核对收支，留出可存资金',reason:'先分清固定支出、浮动开销和一次性收支，再确认真正能持续存下的金额。',tradeoff:'核对账单本身不会增加收入，也不会自动减少支出。',...(has('bills')?{actionId:'bills'}:{kind:'edit'})};
  const save={id:'keep',title:'保留当前目标与期限',reason:`按已确认收支，每月安排${money(s.monthlyPlannedCents??s.monthlyRequiredCents)}即可覆盖目标，不必为追赶进度提高投资风险。`,tradeoff:'仍需核对未计入的浮动开销；保存只记录计划。',...(has('save')?{actionId:'save'}:{kind:'edit'})};
  const result=(status,headline,explanation,preferred,alternatives=[],lastResort=null)=>({status,headline,explanation,preferred,alternatives,lastResort});
  if(s.gapCents===0)return result('covered','可计入的本金已覆盖目标','应急金已从可计入本金中扣除；这份目标不需要额外安排月度存入。',{...save,title:'先保留应急金，不再追加存入',reason:'本次目标已有资金覆盖，继续额外存入并非达标所必需。'},[edit]);
  const capacity=s.monthlyCapacityCents;
  if(capacity==null||!Number.isFinite(capacity))return result('needs_input','还不能判断每月能存多少','收入或支出尚未核对，不把未知金额当成0。',edit);
  if(capacity<=0)return result('cashflow',capacity<0?'目前每月支出高于收入':'目前还没有可存结余',`按已确认收支，每月${capacity<0?'收支缺口':'结余'}为${money(Math.abs(capacity))}，当前不安排新增存入。`,bills,[edit],{title:'如果暂时腾不出结余',body:'先把目标保留为待调整，等收入或可支配支出有实际变化再继续。单纯延长时间不能解决持续没有结余的问题，也不要依靠借款或高风险收益补差。',actionIds:has('save')?['save']:[]});
  if(s.feasible===true){
    const room=capacity-(s.monthlyPlannedCents??s.monthlyRequiredCents),tight=room<capacity*.1;
    return result(tight?'tight':'on_track',tight?'目标可安排，但月度余量较小':'按当前收支，目标可以安排',`按已确认的月结余${money(capacity)}测算，存入后每月还剩约${money(Math.max(0,room))}。`,{...save,tradeoff:tight?'这份安排接近用完月结余；先核对浮动开销与应急需要，再决定是否保存。':'这部分余量不等于全部可自由使用，尚未计入的开销仍需预留。'},[edit]);
  }
  const extend=has('extend')&&!constraints.keepDeadline?{id:'extend',actionId:'extend',title:'保留目标，给自己更多时间',reason:`在每月不超过${money(capacity)}的已知结余内重新安排，优先保留你原来的金额目标。`,tradeoff:`${actions.find(a=>a.id==='extend').label}。需要你接受更晚完成，测算不计投资收益。`}:null;
  const reduce=has('adjust-target')&&!constraints.keepTarget?{id:'adjust-target',actionId:'adjust-target',title:'保留期限，先完成阶段目标',reason:`按原期限，当前预算预计可安排${money(s.atDeadlineCents??0)}；先把它作为可执行的阶段目标。`,tradeoff:'原金额目标会降低，剩余部分需要另外安排，不能视为已经完成。'}:null;
  const choices=[extend,reduce].filter(Boolean);
  const preferred=choices[0]??{...bills,title:'先核对是否有真实可调整的收支',reason:constraints.keepDeadline&&constraints.keepTarget?'你要求目标与期限都不变，现有预算无法同时满足这两个条件。':'现有可用调整方式不足以给出稳妥的达标安排。'};
  return result('shortfall','原目标暂时超出当前预算',`按预算到期预计${money(s.atDeadlineCents??0)}，距原目标还差${money(s.shortfallAtDeadlineCents??0)}。`,preferred,[...choices.slice(1),edit],{title:'如果这些调整都不能接受',body:choices.length?'保留原目标为待调整，先核实是否有尚未计入的收入、奖金或可调整的非必要开销。有新条件后再算，不把尚未发生的收入或理财收益算作已存资金。':'在目标、期限与当前收支都不变的前提下，目前没有可行的达标方案。可以先保留目标，等真实条件变化后继续；不建议用借款或高风险收益填补缺口。',actionIds:has('save')?['save']:[]});
}
