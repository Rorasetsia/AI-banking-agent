import {DateTimePicker} from './DateTimePicker';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle, ArrowLeftRight, CalendarDays, Car, ChevronRight, Clock, Download, Film, Home,
  PiggyBank, Receipt, Repeat, Search, ShoppingBag, Sparkles, TrendingUp, Utensils, Wallet,
} from 'lucide-react';
import { day, money } from '../api';
import type { Analysis, BankState, PageProps, Transaction } from '../types';
import { OverviewAssistant } from './OverviewAssistant';
import './Overview.css';

type AnalysisExtras = {
  investmentInflowCents?: number;
  investmentOutflowCents?: number;
  consumptionCents?: number;
  scopeNote?: string;
};

type CashflowExtras = {
  projectedBalanceCents?: number;
  projectedReservedCents?: number;
  releasedReserveCents?: number;
  assumptions?: string[];
};

const shanghaiFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
});

function shanghaiDate(value: string): string {
  const parts = shanghaiFormat.formatToParts(new Date(value));
  const pick = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

function shanghaiMonth(value: string): string {
  return shanghaiDate(value).slice(0, 7);
}

const CATEGORY_GLYPHS: Record<string, ReactNode> = {
  '餐饮': <Utensils size={16} aria-hidden='true' />,
  '交通': <Car size={16} aria-hidden='true' />,
  '购物': <ShoppingBag size={16} aria-hidden='true' />,
  '居住': <Home size={16} aria-hidden='true' />,
  '娱乐': <Film size={16} aria-hidden='true' />,
  '转账': <ArrowLeftRight size={16} aria-hidden='true' />,
  '理财': <TrendingUp size={16} aria-hidden='true' />,
};

function CategoryIcon({ category }: { category: string }) {
  return (
    <span className='tx-icon' aria-hidden='true'>
      {CATEGORY_GLYPHS[category] ?? <Receipt size={16} aria-hidden='true' />}
    </span>
  );
}

function isInvestment(tx: Transaction): boolean {
  return tx.kind === 'wealth' || tx.category === '理财';
}

function flowTypeLabel(tx: Transaction): string {
  if (tx.amountCents >= 0) {
    if (isInvestment(tx)) return '投资流入';
    if (tx.category === '转账') return '转账流入';
    return '收入';
  }
  if (isInvestment(tx)) return '投资流出';
  if (tx.category === '转账') return '转账流出';
  return '消费支出';
}

function TrendChart({ points, title }: { points: Analysis['timeline']; title: string }) {
  if (points.length === 0) return <p className='empty-state'>暂无可绘制的数据。</p>;
  const width = 640;
  const height = 200;
  const padX = 18;
  const padY = 24;
  const base = height - padY;
  const plot = height - padY * 2;
  const max = Math.max(1, ...points.flatMap(point => [point.incomeCents, point.expenseCents]));
  const step = points.length > 1 ? (width - padX * 2) / (points.length - 1) : 0;
  const x = (index: number) => padX + index * step;
  const y = (value: number) => base - (Math.max(0, value) / max) * plot;
  const series = (key: 'incomeCents' | 'expenseCents') =>
    points.map((point, index) => `${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`).join(' ');
  const labelEvery = points.length > 16 ? Math.ceil(points.length / 8) : 1;
  return (
    <figure className='trend-chart'>
      <svg className='trend-svg' viewBox={`0 0 ${width} ${height}`} width='100%' role='img' aria-label={title}>
        <title>{title}</title>
        {[0.25, 0.5, 0.75].map(ratio => (
          <line key={ratio} className='chart-grid' x1={padX} x2={width - padX} y1={base - plot * ratio} y2={base - plot * ratio} />
        ))}
        <line className='chart-baseline' x1={padX} x2={width - padX} y1={base} y2={base} />
        <polyline className='chart-line chart-line-income' points={series('incomeCents')} fill='none' />
        <polyline className='chart-line chart-line-expense' points={series('expenseCents')} fill='none' />
        {points.map((point, index) => (
          <g key={point.label}>
            <circle className='chart-dot chart-dot-income' cx={x(index)} cy={y(point.incomeCents)} r={2.4} />
            <circle className='chart-dot chart-dot-expense' cx={x(index)} cy={y(point.expenseCents)} r={2.4} />
            {index % labelEvery === 0 ? (
              <text className='chart-label' x={x(index)} y={height - 6} textAnchor='middle'>{point.label}</text>
            ) : null}
          </g>
        ))}
      </svg>
      <figcaption className='chart-legend'>
        <span className='legend legend-income'>流入</span>
        <span className='legend legend-expense'>流出</span>
        <span className='legend-note'>零基线起算 · 单位：元</span>
      </figcaption>
    </figure>
  );
}

export function Overview(props: PageProps) {
  const { state } = props;
  const analysis = state.analysis as Analysis & AnalysisExtras;
  const cashflow = state.cashflow as BankState['cashflow'] & CashflowExtras;

  const holdingsCents = state.holdings.reduce((total, holding) => {
    const product = state.products.find(item => item.id === holding.productId);
    return total + (product ? product.unitPriceCents * holding.shares : 0);
  }, 0);
  const scopeNote = analysis.scopeNote ?? '收入、支出、净流入均为银行流水口径，不等于投资收益或利润；消费支出不含“理财”和“转账”分类。';
  const investmentInflowCents = analysis.investmentInflowCents ?? 0;
  const investmentOutflowCents = analysis.investmentOutflowCents ?? 0;
  const consumptionCents = analysis.consumptionCents ?? 0;
  const projectedBalanceCents = cashflow.projectedBalanceCents ?? (state.account.balanceCents - cashflow.upcomingCents);
  const projectedReservedCents = cashflow.projectedReservedCents ?? state.account.reservedCents;
  const releasedReserveCents = cashflow.releasedReserveCents ?? 0;
  const projectedAvailableCents = cashflow.projectedCents ?? (projectedBalanceCents - projectedReservedCents);
  const flowAssumptions = cashflow.assumptions ?? [
    '只预测已授权订阅、已排期转账与生日订单，不含未来收入或理财收益。',
    '排期任务可能失败；当前只是预测，尚未实际扣款。',
  ];
  const consumptionCategories = analysis.consumptionCategories ?? analysis.categories.filter(item => item.name !== '理财' && item.name !== '转账');
  const topCategories = consumptionCategories.slice(0, 5);
  const maxCategoryCents = Math.max(1, ...topCategories.map(item => item.amountCents));
  const recent = useMemo(
    () => [...state.transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6),
    [state.transactions],
  );
  const pendingPlans = useMemo(
    () => state.plans.filter(plan => plan.status === 'pending').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3),
    [state.plans],
  );
  const upcoming = cashflow.items.slice(0, 5);
  const subscriptions = state.subscriptions.filter(item => item.status === 'active').slice(0, 3);
  const schedules = state.schedules.filter(item => item.status === 'scheduled').slice(0, 3);

  return (
    <div className='page overview'>
      <header className='overview-hero'>
        <p className='eyebrow'><Sparkles size={14} aria-hidden='true' /> 小苔 · 私人银行工作台</p>
        <h1>把日常交给小苔，把时间留给生活。</h1>
      </header>

      <OverviewAssistant {...props} />
      <div className='overview-layout'>
        <div className='overview-main'>
          <section className='asset-card' aria-labelledby='asset-heading'>
            <div className='asset-canopy' aria-hidden='true' />
            <div className='asset-lead'>
              <h2 id='asset-heading' className='card-label'><Wallet size={16} aria-hidden='true' /> 活期余额</h2>
              <p className='asset-total'>{money(state.account.balanceCents)}</p>
              <p className='asset-formula'>资产估值合计 {money(state.account.balanceCents + holdingsCents)}，其中持仓估值 {money(holdingsCents)}。持仓不能直接作为活期资金使用。</p>
              <p className='asset-note'>{scopeNote}</p>
              <p className='asset-note'>本月投资流入 {money(investmentInflowCents)}，投资流出 {money(investmentOutflowCents)}；消费支出 {money(consumptionCents)}（不含“理财”和“转账”分类）。</p>
            </div>
            <dl className='asset-stats'>
              <div><dt><PiggyBank size={14} aria-hidden='true' /> 可用资金</dt><dd>{money(cashflow.availableCents)}</dd></div>
              <div><dt>已预留</dt><dd>{money(state.account.reservedCents)}</dd></div>
              <div><dt>本月总流入</dt><dd>{money(analysis.incomeCents)}</dd></div>
              <div><dt>本月总流出</dt><dd>{money(analysis.expenseCents)}</dd></div>
            </dl>
          </section>

          <div className='overview-grid'>
            <section className='panel panel-trend' aria-labelledby='trend-heading'>
              <div className='panel-head'>
                <h2 id='trend-heading'>资金流走势</h2>
                <p className='panel-meta'>{analysis.title} · 共 {analysis.count} 笔 · 流水口径</p>
              </div>
              <TrendChart points={analysis.timeline} title={`${analysis.title}资金流入与流出趋势`} />
            </section>



            <section className='panel panel-categories' aria-labelledby='category-heading'>
              <div className='panel-head'><h2 id='category-heading'>消费分类</h2><p className='panel-meta'>不含理财与转账 · {analysis.title}</p></div>
              <ul className='category-bars'>
                {topCategories.map(item => (
                  <li key={item.name}>
                    <span className='category-name'>{item.name}</span>
                    <span className='category-track' aria-hidden='true'>
                      <span className='category-fill' style={{ width: `${Math.max(2, Math.round((item.amountCents / maxCategoryCents) * 100))}%` }} />
                    </span>
                    <span className='category-amount'>{money(item.amountCents)}</span>
                  </li>
                ))}
                {topCategories.length === 0 ? <li className='empty-state'>本期没有消费支出（理财与转账不计入消费）。</li> : null}
              </ul>
            </section>

            <section className='panel panel-transactions' aria-labelledby='recent-heading'>
              <div className='panel-head'><h2 id='recent-heading'>近期交易</h2><p className='panel-meta'>最新 6 笔 · 含投资与转账</p></div>
              <ul className='tx-list'>
                {recent.map(tx => (
                  <li key={tx.id} className='tx-row'>
                    <CategoryIcon category={tx.category} />
                    <div className='tx-body'>
                      <p className='tx-merchant'>{tx.merchant}</p>
                      <p className='tx-meta'>{flowTypeLabel(tx)} · {day(tx.date)} · {tx.memo || '无备注'}</p>
                    </div>
                    <span className={tx.amountCents >= 0 ? 'tx-amount tx-in' : 'tx-amount tx-out'}>
                      {tx.amountCents >= 0 ? '+' : ''}{money(tx.amountCents)}
                    </span>
                  </li>
                ))}
                {recent.length === 0 ? <li className='empty-state'>还没有流水记录。</li> : null}
              </ul>
            </section>





          </div>
        </div>
        <aside className='overview-rail'>
          <section className='panel stamp-card' aria-labelledby='plans-heading'>
            <div className='panel-head'><h2 id='plans-heading'>待确认计划</h2></div>
            <div className='plan-list'>
              {pendingPlans.map(plan => (
                <button key={plan.id} type='button' className='plan-row' onClick={() => props.openPlan(plan)}>
                  <span className='plan-body'>
                    <span className='plan-title'>{plan.title}</span>
                    <span className='plan-meta'>{plan.summary}</span>
                  </span>
                  <span className='plan-side'>
                    <span className='plan-impact'>{money(plan.impactCents)}</span>
                    <ChevronRight size={16} aria-hidden='true' />
                  </span>
                </button>
              ))}
              {pendingPlans.length === 0 ? <p className='empty-state'>没有待确认的计划。</p> : null}
            </div>
          </section>

          <section className='panel stamp-card' aria-labelledby='schedule-heading'>
            <div className='panel-head'><h2 id='schedule-heading'><CalendarDays size={16} aria-hidden='true' /> 预约</h2></div>
            <ul className='mini-list'>
              {schedules.map(item => (
                <li key={item.id}>
                  <span className='mini-title'>{item.title}</span>
                  <span className='mini-meta'>{day(item.executeAt)} · {item.status}</span>
                </li>
              ))}
              {schedules.length === 0 ? <li className='empty-state'>没有待执行的预约。</li> : null}
            </ul>
          </section>
          <section className='panel panel-cashflow stamp-card' aria-labelledby='cashflow-heading'>
            <div className='panel-head'>
              <h2 id='cashflow-heading'><Clock size={16} aria-hidden='true' /> 未来 30 日现金流</h2>
            </div>
            <p className='cashflow-projected'>预计可用 <strong>{money(projectedAvailableCents)}</strong></p>
            <p className='panel-meta'>
              预计余额 {money(projectedBalanceCents)} · 预计预留 {money(projectedReservedCents)}
              {releasedReserveCents > 0 ? ` · 生日预留到期释放 ${money(releasedReserveCents)}` : ''}
            </p>
            <p className='panel-meta'>已排期支付合计 {money(cashflow.upcomingCents)}，含授权订阅、预约转账与生日订单。</p>
            <ul className='cashflow-list'>
              {upcoming.map(item => (
                <li key={item.id}>
                  <span className='cashflow-date'>{day(item.date)}</span>
                  <span className='cashflow-title'>{item.title}{item.type === 'birthday_order' ? ' · 生日订单' : ''}</span>
                  <span className='cashflow-amount'>{money(item.amountCents)}</span>
                </li>
              ))}
              {upcoming.length === 0 ? <li className='empty-state'>未来 30 日没有已排期的扣款或转账。</li> : null}
            </ul>
            <p className='panel-meta'>{flowAssumptions.join(' ')}</p>
          </section>
            <section className='panel stamp-card' aria-labelledby='subscriptions-heading'>
              <div className='panel-head'><h2 id='subscriptions-heading'><Repeat size={16} aria-hidden='true' /> 订阅</h2></div>
              <ul className='mini-list'>
                {subscriptions.map(item => (
                  <li key={item.id}>
                    <span className='mini-title'>{item.name}</span>
                    <span className='mini-meta'>{money(item.amountCents)} · 下次 {day(item.nextChargeAt)}</span>
                  </li>
                ))}
                {subscriptions.length === 0 ? <li className='empty-state'>没有进行中的订阅。</li> : null}
              </ul>
            </section>
        </aside>
      </div>
    </div>
  );
}

export function Bills(props: PageProps) {
  const { state, busy } = props;
  const currentMonth = shanghaiMonth(state.now);
  const [period, setPeriod] = useState<'month' | 'year'>('month');
  const [month, setMonth] = useState(currentMonth);
  const [year, setYear] = useState(Number(currentMonth.slice(0, 4)));
  const [category, setCategory] = useState('全部');
  const [query, setQuery] = useState('');
  const [exportNote, setExportNote] = useState('');
  const [greenSource, setGreenSource] = useState(false);
  const [detailDate,setDetailDate]=useState('');
  const [detailPage,setDetailPage]=useState(1);
  useEffect(() => {
    try {
      const id = sessionStorage.getItem('xiaotai.green.transactionFocus');
      sessionStorage.removeItem('xiaotai.green.transactionFocus');
      const tx = state.transactions.find(item => item.id === id);
      if (!tx) return;
      setMonth(shanghaiMonth(tx.date)); setPeriod('month'); setCategory('全部'); setQuery(tx.id); setGreenSource(true);
    } catch { /* 没有可用会话存储时继续显示普通账单。 */ }
  }, [state.userId]);

  const categories = useMemo(
    () => ['全部', ...Array.from(new Set(state.transactions.map(item => item.category))).sort((a, b) => a.localeCompare(b, 'zh-CN'))],
    [state.transactions],
  );
  const years = useMemo(() => {
    const values = new Set(state.transactions.map(item => Number(shanghaiDate(item.date).slice(0, 4))));
    values.add(Number(currentMonth.slice(0, 4)));
    values.add(year);
    return Array.from(values).sort((a, b) => b - a);
  }, [state.transactions, currentMonth, year]);

  const filtered = useMemo(
    () => state.transactions
      .filter(tx => {
        const date = shanghaiDate(tx.date);
        if (period === 'month' ? !date.startsWith(month) : !date.startsWith(String(year))) return false;
        if (category !== '全部' && tx.category !== category) return false;
        const keyword = query.trim().toLowerCase();
        if (!keyword) return true;
        return [tx.id, tx.merchant, tx.memo, tx.category].some(value => value.toLowerCase().includes(keyword));
      })
      .sort((a, b) => b.date.localeCompare(a.date)),
    [state.transactions, period, month, year, category, query],
  );
  const detailRows=useMemo(()=>detailDate?filtered.filter(tx=>shanghaiDate(tx.date)===detailDate):filtered,[filtered,detailDate]);
  const totalPages=Math.max(1,Math.ceil(detailRows.length/10));
  const currentPage=Math.min(detailPage,totalPages);
  const pagedRows=detailRows.slice((currentPage-1)*10,currentPage*10);
  useEffect(()=>{setDetailPage(1);setExportNote('');},[period,month,year,category,query,detailDate,state.userId]);

  function togglePeriod(){
    setDetailDate('');
    if(period==='month'){setYear(Number(month.slice(0,4)));setPeriod('year');}
    else setPeriod('month');
  }

  const summary = useMemo(() => {
    let incomeCents = 0;
    let expenseCents = 0;
    let incomeCount = 0;
    let expenseCount = 0;
    const groups = new Map<string, { amountCents: number; count: number }>();
    for (const tx of filtered) {
      if (tx.amountCents >= 0) {
        incomeCents += tx.amountCents;
        incomeCount += 1;
      } else {
        const amountCents = -tx.amountCents;
        expenseCents += amountCents;
        expenseCount += 1;
        const group = groups.get(tx.category) ?? { amountCents: 0, count: 0 };
        group.amountCents += amountCents;
        group.count += 1;
        groups.set(tx.category, group);
      }
    }
    const categoryStats = [...groups.entries()]
      .map(([name, value]) => ({ name, ...value }))
      .sort((a, b) => b.amountCents - a.amountCents);
    return { incomeCents, expenseCents, netCents: incomeCents - expenseCents, incomeCount, expenseCount, categoryStats };
  }, [filtered]);

  const flowSplit = useMemo(() => {
    let investmentInflowCents = 0;
    let investmentOutflowCents = 0;
    let consumptionCents = 0;
    let transferOutCents = 0;
    for (const tx of filtered) {
      if (tx.amountCents >= 0) {
        if (isInvestment(tx)) investmentInflowCents += tx.amountCents;
        continue;
      }
      const amountCents = -tx.amountCents;
      if (isInvestment(tx)) investmentOutflowCents += amountCents;
      else if (tx.category === '转账') transferOutCents += amountCents;
      else consumptionCents += amountCents;
    }
    return { investmentInflowCents, investmentOutflowCents, consumptionCents, transferOutCents };
  }, [filtered]);

  const points = useMemo(() => {
    const buckets = new Map<string, { incomeCents: number; expenseCents: number }>();
    for (const tx of filtered) {
      const fullDate = shanghaiDate(tx.date);
      const key = period === 'month' ? fullDate : fullDate.slice(0, 7);
      const bucket = buckets.get(key) ?? { incomeCents: 0, expenseCents: 0 };
      if (tx.amountCents >= 0) bucket.incomeCents += tx.amountCents;
      else bucket.expenseCents -= tx.amountCents;
      buckets.set(key, bucket);
    }
    if (period === 'year') {
      return Array.from({ length: 12 }, (_, index) => {
        const key = `${year}-${String(index + 1).padStart(2, '0')}`;
        const bucket = buckets.get(key) ?? { incomeCents: 0, expenseCents: 0 };
        return { label: `${index + 1}月`, incomeCents: bucket.incomeCents, expenseCents: bucket.expenseCents };
      });
    }
    const [y, m] = month.split('-').map(Number);
    const days = Number.isFinite(y) && Number.isFinite(m) ? new Date(Date.UTC(y, m, 0)).getUTCDate() : 31;
    return Array.from({ length: days }, (_, index) => {
      const key = `${month}-${String(index + 1).padStart(2, '0')}`;
      const bucket = buckets.get(key) ?? { incomeCents: 0, expenseCents: 0 };
      return { label: String(index + 1), incomeCents: bucket.incomeCents, expenseCents: bucket.expenseCents };
    });
  }, [filtered, period, month, year]);

  const anomalies = useMemo(() => {
    const found: { id: string; title: string; reason: string; amountCents: number }[] = [];
    const seen = new Map<string, string>();
    const ordered = [...filtered].sort((a, b) => a.date.localeCompare(b.date));
    for (const tx of ordered) {
      if (tx.amountCents >= 0) continue;
      const amountCents = -tx.amountCents;
      if (amountCents >= 300000) {
        found.push({ id: `${tx.id}-large`, title: '单笔大额支出', reason: `${tx.merchant} 单笔 ${money(amountCents)}，达到 3,000 元检查线，建议核对用途与凭证。`, amountCents });
      }
      const key = `${tx.merchant}|${shanghaiDate(tx.date)}|${tx.amountCents}`;
      const first = seen.get(key);
      if (first) {
        found.push({ id: `${tx.id}-duplicate`, title: '疑似重复扣款', reason: `${day(tx.date)} 与流水 ${first} 同商户、同金额重复出现，建议核对是否重复扣款。`, amountCents });
      } else {
        seen.set(key, tx.id);
      }
    }
    return found;
  }, [filtered]);

  const maxCategoryCents = Math.max(1, ...summary.categoryStats.map(item => item.amountCents));

  function downloadCsv() {
    if (detailRows.length === 0) return;
    const quote = String.fromCharCode(34);
    const guard = (value: string) => {
      const text = String(value ?? '');
      const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
      return quote + safe.split(quote).join(quote + quote) + quote;
    };
    const header = ['日期', '商户', '分类', '流水类型', '金额(元)', '备注', '流水号'].map(guard).join(',');
    const rows = detailRows.map(tx => [
      shanghaiDate(tx.date),
      tx.merchant,
      tx.category,
      flowTypeLabel(tx),
      (Math.abs(tx.amountCents) / 100).toFixed(2),
      tx.memo || '',
      tx.id,
    ].map(guard).join(','));
    const blob = new Blob([String.fromCharCode(0xFEFF) + [header, ...rows].join(String.fromCharCode(13, 10))], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `小苔账单-${detailDate || (period === 'month' ? month : `${year}年`)}-${detailRows.length}笔.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setExportNote(`已导出 ${detailRows.length} 笔流水（合成数据，包含全部分页）。`);
  }

  return (
    <div className='page bills' aria-busy={busy}>
      {greenSource && <div className='green-source-note'><span>来自绿色金融 · 已定位原始流水</span><button type='button' onClick={()=>props.navigate?.('green')}>返回绿色分析</button><button type='button' onClick={()=>{setQuery('');setGreenSource(false);}}>查看当月全部</button></div>}
      <header className='page-head'>
        <p className='eyebrow'><Receipt size={14} aria-hidden='true' /> 账单洞察</p>
        <h1>账单洞察</h1>
      </header>

      <section className='bills-filters' aria-label='账单筛选条件'>
        <button type='button' className='period-toggle' data-period={period} role='switch' aria-checked={period==='year'} aria-label={period==='month'?'按月统计，切换为按年':'按年统计，切换为按月'} onClick={togglePeriod}>
          <span className='period-orb' aria-hidden='true'>{period === 'month' ? <CalendarDays size={20}/> : <TrendingUp size={20}/>}</span>
          <span className='period-label'>{period==='month'?'按月':'按年'}</span>
        </button>
        {period === 'month' ? (
          <div className='field'>
            <label htmlFor='bills-month'>月份</label>
            <DateTimePicker
              id='bills-month'
              type='month'
              value={month}
              onChange={value => {
                if (value) {setMonth(value);setDetailDate('');}
              }}
            />
          </div>
        ) : (
          <div className='field'>
            <label htmlFor='bills-year'>年份</label>
            <select id='bills-year' value={year} onChange={event => {setYear(Number(event.target.value));setDetailDate('');}}>
              {years.map(value => <option key={value} value={value}>{value} 年</option>)}
            </select>
          </div>
        )}
        <div className='field'>
          <label htmlFor='bills-category'>分类</label>
          <select id='bills-category' value={category} onChange={event => setCategory(event.target.value)}>
            {categories.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        <div className='field field-search'>
          <label htmlFor='bills-search'>搜索商户或备注</label>
          <span className='search-wrap'>
            <Search size={16} aria-hidden='true' />
            <input id='bills-search' type='search' value={query} placeholder='商户、分类或备注关键词' onChange={event => setQuery(event.target.value)} />
          </span>
        </div>
      </section>

      <div className='bill-summary'>
        {[
          { key: '总流入', value: summary.incomeCents, meta: `${summary.incomeCount} 笔 · 含理财赎回等，等于流水流入而非收入`, tone: 'stat-in' },
          { key: '总流出', value: summary.expenseCents, meta: `${summary.expenseCount} 笔 · 含投资与转账`, tone: 'stat-out' },
          { key: '净流入', value: summary.netCents, meta: `共 ${filtered.length} 笔 · 流水口径，不等于利润`, tone: '' },
        ].map(card => (
          <article key={card.key} className='stat-card'>
            <h2>{card.key}</h2>
            <p className={`stat-value ${card.tone}`.trim()}>{money(card.value)}</p>
            <p className='stat-meta'>{card.meta}</p>
          </article>
        ))}
      </div>

      <p className='rule-note'>
        当前筛选的流水口径：投资流入 {money(flowSplit.investmentInflowCents)}、投资流出 {money(flowSplit.investmentOutflowCents)}、消费支出 {money(flowSplit.consumptionCents)}（不含“理财”和“转账”分类）、转账流出 {money(flowSplit.transferOutCents)}。投资流入/流出不等于投资收益或亏损，总流入/总流出也不等于利润。
      </p>

      <div className='bill-grid'>
        <section className='panel' aria-labelledby='bill-trend-heading'>
          <div className='panel-head'>
            <h2 id='bill-trend-heading'>{period === 'month' ? `${month} 每日资金流` : `${year} 年 12 个月资金流`}</h2>
            <p className='panel-meta'>无流水的日期按 0 补齐 · 流水口径</p>
          </div>
          <TrendChart points={points} title={period === 'month' ? `${month} 每日流入与流出` : `${year} 年月度流入与流出`} />
        </section>
        <section className='panel' aria-labelledby='bill-category-heading'>
          <div className='panel-head'>
            <h2 id='bill-category-heading'>总流出分类（含投资与转账）</h2>
            <p className='panel-meta'>分类金额按当前筛选计算</p>
          </div>
          <ul className='category-bars'>
            {summary.categoryStats.map(item => (
              <li key={item.name}>
                <span className='category-name'>{item.name}</span>
                <span className='category-track' aria-hidden='true'>
                  <span className='category-fill' style={{ width: `${Math.max(2, Math.round((item.amountCents / maxCategoryCents) * 100))}%` }} />
                </span>
                <span className='category-amount'>{money(item.amountCents)} · {item.count} 笔</span>
              </li>
            ))}
            {summary.categoryStats.length === 0 ? <li className='empty-state'>当前筛选没有流出。</li> : null}
          </ul>
        </section>
      </div>

      <section className='panel panel-anomalies' aria-labelledby='anomaly-heading'>
        <div className='panel-head'>
          <h2 id='anomaly-heading'><AlertTriangle size={16} aria-hidden='true' /> 异常线索</h2>
          <p className='panel-meta'>当前筛选中的流水提示；后续核对与争议材料统一到扣费监测</p>
        </div>
        <ul className='anomaly-list'>
          {anomalies.map(item => (
            <li key={item.id}>
              <p className='anomaly-title'>{item.title} · {money(item.amountCents)}</p>
              <p className='anomaly-reason'>{item.reason}</p>
            </li>
          ))}
          {anomalies.length === 0 ? <li className='empty-state'>当前筛选未触发检查规则。</li> : null}
        </ul>
        <p className='rule-note'>本地检查规则：同商户同日同金额重复支出、单笔支出 ≥ 3,000 元；仅提示核对，不构成欺诈或违约认定。</p>
        {props.navigate && <button type='button' className='button button--ghost' onClick={() => props.navigate?.('mandates')}>前往扣费监测核对</button>}
      </section>

      <section className='panel' aria-labelledby='bill-table-heading'>
        <div className='panel-head'>
          <h2 id='bill-table-heading'>流水明细</h2>
          <div className='panel-tools'>
            <p className='panel-meta'>共 {detailRows.length} 笔 · 合成数据</p>
            <button type='button' className='ghost-button' onClick={downloadCsv} disabled={detailRows.length === 0}>
              <Download size={16} aria-hidden='true' /> 导出当前筛选 CSV
            </button>
          </div>
        </div>
        {exportNote ? <p className='form-hint' role='status'>{exportNote}</p> : null}
        <div className='bill-date-search'>
          <label className='field' htmlFor='bill-detail-date'><span>查询某天的流水</span><DateTimePicker id='bill-detail-date' type='date' value={detailDate} onChange={value=>{setDetailDate(value);if(value){setMonth(value.slice(0,7));setYear(Number(value.slice(0,4)));setPeriod('month');}}}/></label>
          {detailDate&&<button type='button' className='button button--ghost' onClick={()=>setDetailDate('')}>查看整月明细</button>}
        </div>
        <div className='table-scroll' role='region' aria-label='流水表，可左右滚动' tabIndex={0}>
          <table className='bill-table'>
            <caption className='sr-only'>按当前筛选命中的流水，包含日期、商户、分类、流水类型、金额与备注</caption>
            <thead>
              <tr>
                <th scope='col'>日期</th>
                <th scope='col'>商户</th>
                <th scope='col'>分类</th>
                <th scope='col'>流水类型</th>
                <th scope='col'>金额</th>
                <th scope='col'>备注</th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.map(tx => (
                <tr key={tx.id}>
                  <td>{shanghaiDate(tx.date)}</td>
                  <td>{tx.merchant}</td>
                  <td>{tx.category}</td>
                  <td>{flowTypeLabel(tx)}</td>
                  <td className={tx.amountCents >= 0 ? 'tx-in' : 'tx-out'}>{tx.amountCents >= 0 ? '+' : '-'}{money(Math.abs(tx.amountCents))}</td>
                  <td>{tx.memo || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {detailRows.length === 0 ? <p className='empty-state' role='status'>{detailDate?'这一天没有符合筛选条件的流水。':'当前筛选没有流水，试试切换月份、分类或清空搜索。'}</p> : null}
        </div>
        <nav className='bill-pagination' aria-label='流水明细分页'>
          <span aria-live='polite'>{detailRows.length?`第 ${(currentPage-1)*10+1}—${Math.min(currentPage*10,detailRows.length)} 条，共 ${detailRows.length} 条`:'共 0 条'}</span>
          <div><button type='button' className='button button--ghost' disabled={currentPage<=1} onClick={()=>setDetailPage(currentPage-1)}>上一页</button><span>第 {currentPage} / {totalPages} 页</span><button type='button' className='button button--ghost' disabled={currentPage>=totalPages} onClick={()=>setDetailPage(currentPage+1)}>下一页</button></div>
        </nav>
      </section>
    </div>
  );
}
