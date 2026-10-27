const localDay = value => new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 10);
const sum = values => values.reduce((total, value) => total + value, 0);
const isInvestment = tx => tx.kind === 'wealth' || tx.category === '理财';
const isOwnMovement = tx => ['own_deposit','own_withdraw'].includes(tx.kind);

export function analyze(state, { period = 'month', month, year, category } = {}) {
  const today = localDay(state.now);
  if (!['month', 'year'].includes(period)) throw Object.assign(new Error('报告周期无效'),{status:400,code:'INVALID_PERIOD'});
  month ??= today.slice(0, 7);
  year ??= Number(today.slice(0, 4));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !Number.isInteger(year) || year < 2000 || year > 2100) throw Object.assign(new Error('报告日期无效，请使用有效年月。'),{status:400,code:'INVALID_PERIOD'});
  const selected = state.transactions.filter(tx => {
    const day = localDay(tx.date);
    return (period === 'month' ? day.startsWith(month) : day.startsWith(String(year))) && (!category || tx.category === category);
  });
  const incomeCents = sum(selected.filter(t => t.amountCents > 0).map(t => t.amountCents));
  const expenseCents = -sum(selected.filter(t => t.amountCents < 0).map(t => t.amountCents));
  const investmentRows = selected.filter(isInvestment);
  const investmentInflowCents = sum(investmentRows.filter(t => t.amountCents > 0).map(t => t.amountCents));
  const investmentOutflowCents = sum(investmentRows.filter(t => t.amountCents < 0).map(t => -t.amountCents));
  const consumptionCents = sum(selected.filter(t => t.amountCents < 0 && !isInvestment(t) && !isOwnMovement(t) && t.category !== '转账').map(t => -t.amountCents));
  const consumptionGroups=new Map();
  for(const row of selected.filter(t=>t.amountCents<0&&!isInvestment(t)&&!isOwnMovement(t)&&t.category!=='转账')){
    const group=consumptionGroups.get(row.category)??{name:row.category,amountCents:0,count:0};
    group.amountCents-=row.amountCents;group.count++;consumptionGroups.set(row.category,group);
  }
  const groups = new Map();
  for (const tx of selected.filter(t => t.amountCents < 0)) {
    const group = groups.get(tx.category) ?? { name: tx.category, amountCents: 0, count: 0 };
    group.amountCents -= tx.amountCents;
    group.count++;
    groups.set(tx.category, group);
  }
  const [y, m] = month.split('-').map(Number);
  const timeline = Array.from({ length: period === 'year' ? 12 : new Date(Date.UTC(y, m, 0)).getUTCDate() }, (_, index) => {
    const prefix = period === 'year' ? `${year}-${String(index + 1).padStart(2, '0')}` : `${month}-${String(index + 1).padStart(2, '0')}`;
    const rows = selected.filter(tx => localDay(tx.date).startsWith(prefix));
    return { label: period === 'year' ? `${index + 1}月` : `${index + 1}`, incomeCents: sum(rows.filter(t => t.amountCents > 0).map(t => t.amountCents)), expenseCents: -sum(rows.filter(t => t.amountCents < 0).map(t => t.amountCents)) };
  });
  const anomalies = [];
  const seen = new Map();
  for (const tx of selected.filter(t => t.amountCents < 0).sort((a, b) => a.date.localeCompare(b.date))) {
    if (-tx.amountCents >= 300000) anomalies.push({ transactionId: tx.id, title: '单笔大额支出', reason: '单笔支出达到预设 3,000 元检查线，建议核对，不能据此认定欺诈。', amountCents: -tx.amountCents });
    const key = `${tx.merchant}|${tx.amountCents}|${localDay(tx.date)}`;
    if (seen.has(key)) anomalies.push({ transactionId: tx.id, title: '疑似重复扣款', reason: `同日同商户同金额再次出现，可与流水 ${seen.get(key)} 核对。`, amountCents: -tx.amountCents });
    seen.set(key, tx.id);
  }
  return {
    period, title: period === 'month' ? `${month} 月度账单` : `${year} 年度账单`, incomeCents, expenseCents, netCents: incomeCents - expenseCents, count: selected.length,
    categories: [...groups.values()].sort((a, b) => b.amountCents - a.amountCents), timeline, anomalies,
    investmentInflowCents, investmentOutflowCents, consumptionCents,
    consumptionCategories:[...consumptionGroups.values()].sort((a,b)=>b.amountCents-a.amountCents),
    scopeNote: '流入、流出、净流入均按银行流水口径统计，不等于投资收益或利润。投资流入/流出按投资交易或“理财”分类单列；消费支出剔除投资交易和“转账”分类。',
    sources: { transactionIds: selected.map(t => t.id), asOf: state.now, filter: { period, month, year, category: category ?? null } },
  };
}

export function cashflow(state) {
  const now = new Date(state.now).getTime();
  const end = now + 30 * 86400000;
  const items = [];
  for (const sub of state.subscriptions.filter(s => s.status === 'active' && s.source === 'authorized')) {
    const cycle = Math.max(1, sub.cycleDays) * 86400000;
    let due = new Date(sub.nextChargeAt).getTime();
    if (due < now) due += Math.ceil((now - due) / cycle) * cycle;
    for (let count = 0; due <= end && count < 31; due += cycle, count++) {
      items.push({ id: `${sub.id}-${due}`, title: sub.name, amountCents: sub.amountCents, date: new Date(due).toISOString(), type: 'subscription' });
    }
  }
  for (const task of state.schedules.filter(s => s.status === 'scheduled' && s.type === 'transfer')) {
    const due = new Date(task.executeAt).getTime();
    if (due >= now && due <= end) items.push({ id: task.id, title: task.title, amountCents: task.params.amountCents, date: task.executeAt, type: 'transfer' });
  }
  const birthdayTasks = state.schedules.filter(task => {
    if (task.status !== 'scheduled' || task.type !== 'birthday_order') return false;
    const due = Date.parse(task.executeAt);
    return Number.isFinite(due) && due >= now && due <= end && Number.isSafeInteger(task.params?.totalCents) && task.params.totalCents > 0;
  });
  for (const task of birthdayTasks) {
    items.push({ id: task.id, title: task.title, amountCents: task.params.totalCents, date: task.executeAt, type: 'birthday_order' });
  }
  items.sort((a, b) => a.date.localeCompare(b.date));
  const availableCents = state.account.balanceCents - state.account.reservedCents;
  const upcomingCents = sum(items.map(item => item.amountCents));
  const dueBirthdayIds = new Set(birthdayTasks.map(task => task.id));
  const releasedBySchedule = new Map();
  for (const goal of state.goals) {
    if (goal.status !== 'reserved' || goal.type !== 'birthday_reserve' || !dueBirthdayIds.has(goal.scheduleId)) continue;
    if (!releasedBySchedule.has(goal.scheduleId) && Number.isSafeInteger(goal.amountCents)) releasedBySchedule.set(goal.scheduleId, goal.amountCents);
  }
  const releasedReserveCents = sum([...releasedBySchedule.values()]);
  const projectedBalanceCents = state.account.balanceCents - upcomingCents;
  const projectedReservedCents = state.account.reservedCents - releasedReserveCents;
  const projectedCents = projectedBalanceCents - projectedReservedCents;
  return {
    availableCents, reservedCents: state.account.reservedCents, upcomingCents, projectedCents,
    projectedBalanceCents, projectedReservedCents, releasedReserveCents, items,
    assumptions: [
      '未来 30 日只预测当前有效的已授权订阅、已排期转账与生日订单，不含未排期消费。',
      '不预测未来收入、理财收益或产品净值变化。',
      '排期任务可能在执行时因余额、卡片状态或限额失败；当前只是预测，尚未实际扣款。',
      '生日订单按预留金额释放预留，并按模拟订单金额计入预计支出；未使用的生日预留会回到可用资金。',
    ],
  };
}

export function detectRecurring(state) {
  const groups=new Map();
  for(const row of state.transactions.filter(t=>t.amountCents<0&&(t.kind==='subscription'||/自动续费|订阅|代扣/.test(t.memo)))) {
    const key=`${row.merchant}|${row.amountCents}`;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row);
  }
  return [...groups.values()].flatMap(rows=>{
    rows.sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
    if(rows.length<3)return [];
    const recent=rows.slice(-3),intervals=recent.slice(1).map((t,i)=>(Date.parse(t.date)-Date.parse(recent[i].date))/86400000);
    if(!intervals.every(d=>d>=25&&d<=35))return [];
    return [{name:rows[0].merchant,amountCents:-rows[0].amountCents,cycleDays:30,transactionIds:recent.map(t=>t.id),reason:'最近三次同商户、同金额扣款间隔25—35天；仅为候选识别，不代表已签约。'}];
  });
}
