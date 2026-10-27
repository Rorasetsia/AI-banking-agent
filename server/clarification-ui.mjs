// UI descriptions for authoritative missing slots. These never authorize a tool.
const field = (id,label,type,prefix='',suffix,min,max) => ({id,label,type,prefix,...(suffix===undefined?{}:{suffix}),...(min===undefined?{}:{min}),...(max===undefined?{}:{max})});
const money = (id,label,prefix) => field(id,label,'money',prefix,'元',0.01,99999999);
const definitions = {
  amountCents: money('amountCents','本次金额','金额'),
  totalCents: money('totalCents','AA总金额','AA总金额'),
  budgetCents: money('budgetCents','预留预算','预留预算'),
  limitCents: money('limitCents','新的额度或单笔限额','限额'),
  shares: field('shares','赎回份额','number','','份',1,99999999),
  participants: field('participants','AA人数（包含自己）','number','','人',2,20),
  eventDate: field('eventDate','生日日期','date','生日日期为'),
  executeAt: field('executeAt','预约执行时间','datetime-local','预约时间为'),
};

function rowsFor(state, key, pending) {
  if (pending.candidates?.length) return pending.candidates;
  if (key==='recipient') return state.contacts??[];
  if (key==='ownCardId') return state.ownCards??[];
  if (key==='cardId') return (state.cards??[]).filter(c=>pending.intent?.kind!=='wealth_buy'||(c.type==='debit'&&c.status==='active'));
  if (key==='productId') return state.products??[];
  if (key==='subscriptionId') return (state.subscriptions??[]).filter(s=>s.status==='active');
  if (key==='scheduleId') return (state.schedules??[]).filter(s=>s.status==='scheduled');
  return [];
}

export function clarificationQuestions(state, pending) {
  if (!pending) return [];
  const keys = Array.isArray(pending.missing)&&pending.missing.length ? pending.missing.slice(0,2) : ['answer'];
  return keys.map(key => {
    const candidates=rowsFor(state,key,pending);
    const options=candidates.slice(0,12).flatMap((row,index)=>{
      if(typeof row==='string'&&row.trim())return [{id:`choice-${index}`,label:row,reply:row}];
      if(!row||typeof row!=='object'||typeof row.id!=='string')return [];
      const tail=row.last4??(typeof row.phone==='string'?row.phone.slice(-4):null);
      const detail=[row.note,tail?`尾号${tail}`:null,row.code].filter(Boolean).join(' · ');
      return [{id:row.id,label:String(row.name??row.title??row.id),...(detail?{detail}:{}),reply:row.id}];
    });
    const spec=Object.hasOwn(definitions,key)?definitions[key]:undefined;
    return {id:key,label:pending.question||'请补充这项信息',
      ...(options.length?{options}:{}),
      fields:[spec??field(key,options.length?'也可以自己填写':'补充信息','text')],
      hint: options.length?'选择已有记录，或填写自己的描述。下一步会重新核对适用条件。':'可直接填写，也可以用自己的话补充；没有填写的条件不会自动假定。'};
  });
}
