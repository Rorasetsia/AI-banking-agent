const dateNumber = value => Date.parse(value + 'T00:00:00Z');
const lastDay = month => { const [y,m]=month.split('-').map(Number);return `${month}-${new Date(Date.UTC(y,m,0)).getUTCDate()}`; };

export function budgetProjection({targetCents,mode,usableStartingCents,monthlyCapacityCents,monthlyRequiredCents,schedule}) {
  const base=mode==='additional'?0:usableStartingCents;
  const planned=monthlyCapacityCents===null?null:Math.min(monthlyRequiredCents,Math.max(0,monthlyCapacityCents));
  let cumulative=base,left=Math.max(0,targetCents-base);
  const budgetSchedule=planned===null?[]:schedule.map(row=>{
    const amountCents=Math.min(left,planned);left-=amountCents;cumulative+=amountCents;
    return {month:row.month,amountCents,cumulativeCents:cumulative};
  });
  return {monthlyPlannedCents:planned,budgetSchedule,atDeadlineCents:planned===null?null:cumulative,
    shortfallAtDeadlineCents:planned===null?null:Math.max(0,targetCents-cumulative)};
}

export function simulateSavings(projection, annualRateBps, today) {
  if(!Number.isInteger(annualRateBps)||annualRateBps < -2000 || annualRateBps > 2000)throw new Error('情景年化需在-20%至20%之间，最多两位小数。');
  const end=dateNumber(projection.deadline),base=projection.mode==='additional'?0:projection.usableStartingCents;
  const lots=[{amountCents:base,date:today},...projection.budgetSchedule.map(row=>({amountCents:row.amountCents,date:lastDay(row.month)>projection.deadline?projection.deadline:lastDay(row.month)}))];
  let contributionCents=0,estimatedReturnCents=0;
  const deposits=lots.map(lot=>{
    const days=Math.max(0,Math.floor((end-dateNumber(lot.date))/86400000));
    const numerator=BigInt(lot.amountCents)*BigInt(annualRateBps)*BigInt(days),denominator=3650000n;
    const interest=Number((numerator<0n?-1n:1n)*((numerator<0n?-numerator:numerator)+denominator/2n)/denominator);
    const returnCents=Math.max(-lot.amountCents,interest);
    contributionCents+=lot.amountCents;estimatedReturnCents+=returnCents;
    return {...lot,days,returnCents};
  });
  const projectedTotalCents=contributionCents+estimatedReturnCents;
  return {annualRateBps,contributionCents,estimatedReturnCents,projectedTotalCents,
    shortfallCents:Math.max(0,projection.targetCents-projectedTotalCents),targetReached:projectedTotalCents>=projection.targetCents,deposits,
    assumptions:['自填年化假设，按365天单利逐笔计算，不是产品报价、历史业绩或收益承诺。','现有可用本金从模拟环境今天起计息；月度新增款按月末存入，截止日提前则该月在截止日存入。','没有计入费用、净值路径、交易确认和赎回到账时间；这里只作目标敏感性比较，不是投资执行日程。']};
}
