import {DateTimePicker} from './DateTimePicker';
import {FeatureEntry} from './FeatureEntry';
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Card as CardType, PageProps, Subscription } from '../types';
import { api, day, money } from '../api';
import { BirthdayJourney } from './BirthdayJourney';
import { SubscriptionWatchStatus } from './SubscriptionWatchStatus';

const DAY = 86_400_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = ''): string {
  if (typeof value === 'string' && value.trim()) return value;
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : fallback;
}

function cents(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isoAfter(iso: string, days: number): string {
  const base = Date.parse(iso);
  return new Date((Number.isNaN(base) ? Date.now() : base) + days * DAY).toISOString();
}

function stamp(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso || '—';
  return new Date(time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function itemLabel(item: unknown): string {
  if (typeof item === 'string') return item;
  if (!isRecord(item)) return '';
  const name = text(item.name, text(item.title, '商品'));
  const amount = cents(item.amountCents) ?? cents(item.priceCents) ?? cents(item.totalCents);
  return amount === null ? name : `${name} ${money(amount)}`;
}

const CARD_STATUS: Record<string, string> = { active: '正常', locked: '已锁定', lost: '已挂失' };
const SUB_STATUS: Record<string, string> = { active: '生效中', cancelled: '已取消' };
const SOURCE_LABEL: Record<string, string> = { authorized: '已授权代扣', detected: '识别候选 · 未授权' };
const SCHEDULE_STATUS: Record<string, string> = { scheduled: '待执行', executed: '已执行', cancelled: '已取消', failed: '失败' };

export function Cards({ state, send: rawSend, busy }: PageProps) {
  const send = (value: string) => rawSend(value).catch(() => {});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const cards = Array.isArray(state.cards) ? state.cards : [];
  const label = (card: CardType) => `尾号${card.last4}的${card.type === 'credit' ? '信用卡' : '借记卡'}`;

  function adjust(card: CardType) {
    const yuan = Number((drafts[card.id] ?? '').trim());
    if (!Number.isFinite(yuan) || yuan <= 0) { setNotice('额度需为大于 0 的数字'); return; }
    setNotice('');
    void send(`把${label(card)}额度调整为${yuan.toFixed(2)}元`);
  }

  return (
    <section className='panel'>
      <div className='section-head'>
        <div>
          <h2>银行卡</h2>
          <p>锁定、解锁、挂失与额度调整都会通过沙箱指令执行。</p>
        </div>
        <button className='button btn-primary' disabled={busy}
          onClick={() => void send('我想申请一张信用卡，仅记录为沙箱申请，不要直接授信')}>
          申请信用卡
        </button>
      </div>
      {notice && <p role='alert'>{notice}</p>}
      <div className='product-grid'>
        {cards.length === 0 && <p>暂无银行卡。</p>}
        {cards.map(card => (
          <article className='card-visual' key={card.id}>
            <div className='section-head'>
              <div>
                <h3>{card.name || (card.type === 'credit' ? '信用卡' : '借记卡')}</h3>
                <small>{label(card)}</small>
              </div>
              <span className='status'>{CARD_STATUS[card.status] ?? card.status}</span>
            </div>
            <p>•••• •••• •••• {card.last4}</p>
            <div className='banking-grid'>
              <div><small>{card.type === 'credit' ? '总额度' : '可用资金'}</small><strong>{money(card.type === 'credit' ? card.limitCents : state.account.balanceCents-state.account.reservedCents)}</strong></div>
              <div><small>单笔限额</small><strong>{money(card.perTxLimitCents)}</strong></div>
            </div>
            <div className='form-grid'>
              <label className='field'>
                <span>调整额度（元）</span>
                <input type='number' min='0.01' step='0.01' value={drafts[card.id] ?? ''}
                  placeholder={(card.limitCents / 100).toFixed(2)}
                  onChange={event => setDrafts({ ...drafts, [card.id]: event.target.value })} />
              </label>
              <button className='button btn-primary' disabled={busy} onClick={() => adjust(card)}>确认调整</button>
            </div>
            <div className='form-grid'>
              {card.status === 'active' && (
                <button className='button btn-secondary' disabled={busy} onClick={() => void send(`锁定${label(card)}`)}>锁定</button>
              )}
              {card.status === 'locked' && (
                <button className='button btn-secondary' disabled={busy} onClick={() => void send(`解锁${label(card)}`)}>解锁</button>
              )}
              {card.status !== 'lost' && (
                <button className='button btn-secondary' disabled={busy} onClick={() => void send(`挂失${label(card)}`)}>挂失</button>
              )}
              {card.status === 'lost' && <small>已挂失，无法解锁。</small>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function Subscriptions({ state, send: rawSend, busy, navigate }: PageProps) {
  const send = (value: string) => rawSend(value).catch(() => {});
  const subscriptions = Array.isArray(state.subscriptions) ? state.subscriptions : [];
  const upcoming = subscriptions
    .filter(item => item.status === 'active' && item.source === 'authorized')
    .slice()
    .sort((a, b) => Date.parse(a.nextChargeAt) - Date.parse(b.nextChargeAt));
  const estimate = (item: Subscription, days: number) =>
    item.cycleDays > 0 ? money((item.amountCents * days) / item.cycleDays) : '—';

  return (
    <section className='panel'>
      <div className='section-head'>
        <div>
          <h2>订阅与代扣</h2>
          <p>这里管理持续扣费授权与下次扣费；涨价提醒、异常核对和争议材料统一在扣费监测中处理。</p>
        </div>
      </div>
      <div className='product-grid'>
        {subscriptions.length === 0 && <p>暂无订阅或识别候选。</p>}
        {subscriptions.map(item => (
          <article className='card-visual' key={item.id}>
            <div className='section-head'>
              <h3>{item.name}</h3>
              <span className='status'>{SUB_STATUS[item.status] ?? item.status}</span>
            </div>
            <p>{SOURCE_LABEL[item.source] ?? item.source} · {item.category}</p>
            {item.evidenceIds && <p className='detection-note'>最近 {item.evidenceIds.length} 笔同商户同金额流水提供周期扣款线索。{item.source==='detected'?'这是待核查候选，不代表已授权。':'授权状态来自沙箱授权记录，流水本身不证明真实商户签约。'}</p>}
            <p>每次 {money(item.amountCents)} · 周期 {item.cycleDays} 天 · 下次 {day(item.nextChargeAt)}</p>
            <p>月均约 {estimate(item, 30)} · 年均约 {estimate(item, 365)}</p>
            <SubscriptionWatchStatus state={state} subscriptionId={item.id} navigate={navigate} />
            {item.status === 'active' ? (
              <button className='button btn-secondary' disabled={busy}
                onClick={() => void send(`取消订阅${item.id}`)}>{item.source==='detected'?'移除识别候选':'取消沙箱代扣'}</button>
            ) : (
              <button className='button btn-secondary' disabled>
                {item.status === 'cancelled' ? '已取消' : '未授权，无法取消'}
              </button>
            )}
          </article>
        ))}
      </div>
      <p className='panel-meta'>取消仅终止本地沙箱代扣授权，不代表真实商户退订。周期扣款候选不等于重复扣款事件；只读监测也不代表自动付款、取消或资金安全保证。</p>
      <div className='section-head'><h3>未来扣费预测</h3></div>
      <p className='panel-meta'>仅按沙箱授权记录预测，未发送外部通知，也未实际代扣。</p>
      {upcoming.length === 0 ? <p>暂无已授权的即将扣费。</p> : (
        <ul className='task-list'>
          {upcoming.map(item => (
            <li key={item.id}>
              <strong>{item.name}</strong>
              <span>{day(item.nextChargeAt)} · {money(item.amountCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Tasks({ state, send: rawSend, busy, openPlan, refresh, navigate }: PageProps) {
  const send = (value: string) => rawSend(value).catch(error => setFormNotice(error instanceof Error?error.message:'请求未完成，请调整后重试。'));
  const [eventDate, setEventDate] = useState('');
  const [budget, setBudget] = useState('1000');
  const [advanceDays, setAdvanceDays] = useState('2');
  const [formNotice, setFormNotice] = useState('');
  const [clockNotice, setClockNotice] = useState('');
  const [advancing, setAdvancing] = useState(false);
  const [birthdayEntryKey,setBirthdayEntryKey]=useState(0);

  const pendingPlans = (Array.isArray(state.plans) ? state.plans : []).filter(plan => plan.status === 'pending');
  const schedules = Array.isArray(state.schedules) ? state.schedules : [];
  const goals = (Array.isArray(state.goals) ? state.goals : []).filter(g => ['reserve','birthday_reserve'].includes(String(g.type)));
  const orders = Array.isArray(state.orders) ? state.orders : [];
  const greenWatches=(state.mandates??[]).filter(m=>m.scope==='green_transport_watch');
  const greenNotifications=(state.notifications??[]).filter(n=>n.kind==='green_budget');

  function submitBirthday(event: FormEvent) {
    event.preventDefault();
    const amount = Number(budget);
    const days = Number(advanceDays);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) { setFormNotice('请选择生日日期'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { setFormNotice('请填写大于 0 的预算'); return; }
    if (!Number.isInteger(days) || days < 1 || days > 30) { setFormNotice('提前天数需为1至30的整数'); return; }
    const localMonth=new Date(Date.parse(state.now)+8*3600000).toISOString().slice(0,7);
    if(eventDate.slice(0,7)!==localMonth){setFormNotice('当前仅支持生日当月预留。请将演示时钟推进至生日当月，再建立方案。');return;}
    if(Date.parse(`${eventDate}T09:00:00+08:00`)-days*DAY<=Date.parse(state.now)){setFormNotice('预约下单时间必须晚于当前沙箱时间，请调整提前天数或核对生日。');return;}
    if(amount<498){setFormNotice('固定模拟商品合计498元，请填写至少498元的预算。');return;}
    setFormNotice('');
    void send(`${eventDate}是爱人生日，提前${days}天订购鲜花和蛋糕，预留${amount.toFixed(2)}元`);
  }

  async function tick(asOf: string) {
    setAdvancing(true);
    setClockNotice('');
    try {
      await api.tick(asOf);
      await refresh();
    } catch (error) {
      setClockNotice(error instanceof Error ? error.message : '演示时钟推进失败');
    } finally {
      setAdvancing(false);
    }
  }

  function nextTask() {
    const now = Date.parse(state.now);
    const horizon = now + 31 * DAY;
    const nextAt = schedules
      .filter(item => item.status === 'scheduled')
      .map(item => Date.parse(item.executeAt))
      .filter(at => Number.isFinite(at) && at <= horizon)
      .sort((a, b) => a - b)[0];
    if (nextAt === undefined) { setClockNotice('31 天内没有可推进到的预约'); return; }
    void tick(new Date(Math.max(now,nextAt)).toISOString());
  }

  return (
    <div className='tasks-layout'>
      {state.savingsAgent && state.savingsAgent.savedPlans.some(plan => plan.status !== 'cancelled') && <section className='panel tasks-card tasks-card--wide' aria-labelledby='tasks-savings-title'>
        <div className='panel-head'><h2 id='tasks-savings-title'>我的存钱目标</h2><button className='button btn-secondary' disabled={busy} onClick={() => void send('查看我的存钱计划')}>继续和小苔规划</button></div>
        <p className='tasks-card-intro'>已保存的规划集中在这里。目标金额与预计节余不计入余额，保存不代表授权自动扣款。</p>
        <ul className='task-list'>{state.savingsAgent.savedPlans.filter(plan => plan.status !== 'cancelled').map(plan => <li key={plan.id}>
          <div className='section-head'><div><strong>{money(plan.input.targetCents)} · {plan.input.mode === 'additional' ? '新增储蓄' : '累计总额'}</strong><p>目标日期 {plan.input.deadline}</p></div><span className='status'>规划已保存</span></div>
          <div className='task-actions'><button className='button btn-secondary' disabled={busy} onClick={() => void send(`查看储蓄计划${plan.id}`)}>查看或调整</button><button className='button btn-secondary' disabled={busy} onClick={() => { if (window.confirm('取消这份储蓄目标？不会取消其它资金预留、预约或委托。')) void send(`取消储蓄计划${plan.id}`); }}>取消目标</button></div>
        </li>)}</ul>
      </section>}
      <section className='panel tasks-card tasks-card--wide' aria-labelledby='tasks-funds-title'>
      <div className='panel-head'><h2 id='tasks-funds-title'>预约资金概览</h2></div>
      <div className='banking-grid tasks-funds'>
        <div><small>银行余额</small><strong>{money(state.account.balanceCents)}</strong></div>
        <div><small>已预留</small><strong>{money(state.account.reservedCents)}</strong></div>
        <div><small>未来30日预计可用</small><strong>{money(state.cashflow.projectedCents)}</strong></div>
      </div>
      <div className='tasks-clock'>
        <div><h3>预约时间模拟</h3><p>推进模拟时间，查看到期预约的执行结果。</p><small>当前模拟时间：{stamp(state.now)}</small></div>
        <div className='tasks-clock-actions'>
          <button className='button btn-secondary' disabled={busy || advancing} onClick={() => void tick(isoAfter(state.now, 1))}>{advancing ? '推进中…' : '+1 天'}</button>
          <button className='button btn-secondary' disabled={busy || advancing} onClick={nextTask}>推进到下一项预约</button>
        </div>
      </div>
      {clockNotice && <p role='alert'>{clockNotice}</p>}
      </section>
      <section className='panel tasks-card' aria-labelledby='tasks-pending-title'>
      <div className='panel-head'><h2 id='tasks-pending-title'>待你确认的操作方案</h2><span className='status'>{pendingPlans.length} 项</span></div>
      <p className='tasks-card-intro'>核对转账、资金预留等操作的对象与金额，再决定是否确认。</p>
      {pendingPlans.length === 0 ? <p className='empty'>暂无待你确认的操作方案。</p> : (
        <ul className='task-list'>
          {pendingPlans.map(plan => (
            <li key={plan.id}>
              <div className='section-head'>
                <div><strong>{plan.title}</strong><p>{plan.summary}</p></div>
                <span className='status'>待确认</span>
              </div>
              <p>影响金额：{money(plan.impactCents)}</p>
              <button className='button btn-primary' disabled={busy} onClick={() => openPlan(plan)}>查看并确认</button>
            </li>
          ))}
        </ul>
      )}
      </section>
      <section className='panel tasks-card' aria-labelledby='tasks-birthday-title'>
      <div className='panel-head'><h2 id='tasks-birthday-title'>生日礼物预约</h2></div>
      <p className='panel-meta'>为爱人安排生日礼物，当前支持当月预留与预约。</p>
      <FeatureEntry title="安排生日礼物" description="选择生日日期、礼物预算与提前天数。" revealKey={birthdayEntryKey}><form id='birthday-form' className='tasks-birthday-form' onSubmit={submitBirthday}>
        <label className='field'><span>生日日期</span><DateTimePicker type='date' value={eventDate} onChange={setEventDate} required /></label>
        <label className='field'><span>预算（元）</span><input type='number' min='0.01' step='0.01' value={budget} onChange={event => setBudget(event.target.value)} required /></label>
        <label className='field'><span>提前天数</span><input type='number' min='1' max='30' step='1' value={advanceDays} onChange={event => setAdvanceDays(event.target.value)} required /></label>
        <button className='button btn-primary' type='submit' disabled={busy}>生成生日方案</button>
      </form>
      {formNotice && <p role='alert'>{formNotice}</p>}
      <p className='tasks-card-intro'>模拟鲜花 299 元 + 蛋糕 199 元；确认方案后会在指定日期自动模拟下单，未确认不会预留或扣款。</p></FeatureEntry>
      </section>
      <section className='panel tasks-card tasks-card--wide' aria-labelledby='tasks-schedules-title'>
      <div className='panel-head'><h2 id='tasks-schedules-title'>预约执行与凭证</h2><span className='status'>{schedules.length} 项</span></div>
      <p className='tasks-card-intro'>查看预约时间、执行进度与结果凭证，也可取消尚未执行的预约。</p>
      {schedules.length === 0 ? <p className='empty'>暂无预约。可从生日礼物预约或转账服务中建立安排。</p> : (
        <ul className='task-list'>
          {schedules.map(item => (
            <li key={item.id}>
              <div className='section-head'>
                <div><strong>{item.title}</strong><small>{({birthday_order:'生日订购',transfer:'预约转账',reminder:'提醒'} as Record<string,string>)[item.type] ?? '预约'} · {stamp(item.executeAt)}</small></div>
                <span className='status'>{SCHEDULE_STATUS[item.status] ?? item.status}</span>
              </div>
              {item.error && <p role='alert'>错误：{item.error}</p>}
              {item.type==='birthday_order'&&<BirthdayJourney state={state} schedule={item} onCards={navigate?()=>navigate('cards'):undefined} onEdit={()=>{
                setEventDate(text(item.params.eventDate));setBudget(String(Number(item.params.budgetCents)/100));setAdvanceDays(String(item.params.daysBefore??2));
                setFormNotice('请核对日期和提前天数，再生成新方案。原预约不会自动重试。');setBirthdayEntryKey(key=>key+1);
              }}/>}
              {item.status==='failed'&&item.type==='transfer'&&navigate&&<button className='button btn-secondary' onClick={()=>navigate('transfers')}>前往转账页重新安排</button>}
              {item.status==='executed'&&item.type!=='birthday_order'&&item.receipt&&<details><summary>查看执行凭证</summary><p>凭证编号：{item.receipt.id}</p><p>流水：{item.receipt.transactionIds.join('、')||'无扣款流水'}</p><p>执行后余额：{money(item.receipt.balanceCents)}</p></details>}
              {item.status === 'awaiting_confirmation' && <button className='button btn-primary' disabled={busy} onClick={() => void send(`重新授权预约${item.id}`)}>核对并重新授权</button>}
              {['scheduled','awaiting_confirmation'].includes(item.status) && (
                <button className='button btn-secondary' disabled={busy} onClick={() => void send(`取消预约${item.id}`)}>取消预约</button>
              )}
            </li>
          ))}
        </ul>
      )}
      </section>
      {greenWatches.length>0 && <section className='panel tasks-card tasks-card--wide green-task-list' aria-label='绿色交通委托'>
        <div className='section-head'><div><h3>绿色交通委托</h3><p>观察创建后的可识别交通消费，不含充值和未知记录；只提醒，不限制交易。</p></div><button type='button' className='button btn-secondary' onClick={()=>navigate?.('green')}>查看绿色分析</button></div>
        <ul className='task-list'>{greenWatches.map(m=><li key={m.id}>
          <strong>{m.title}</strong><p>{({active:'观察中',paused:'已暂停',revoked:'已撤销',expired:'已到期'} as Record<string,string>)[m.status]??m.status} · 提醒线 {money(m.thresholdCents)} · 到期 {stamp(m.expiresAt)}</p>
          <small>下次检查 {stamp(m.nextRunAt)}；暂停或撤销不会释放另行设置的预算。</small>
          <div className='plan-actions'>{m.status==='active'&&<button type='button' className='button btn-secondary' disabled={busy} onClick={()=>void send(`暂停委托${m.id}`)}>暂停</button>}{m.status==='paused'&&<button type='button' className='button btn-secondary' disabled={busy} onClick={()=>void send(`恢复委托${m.id}`)}>恢复</button>}{['active','paused','expired'].includes(m.status)&&<button type='button' className='button btn-secondary' disabled={busy} onClick={()=>void send(`撤销委托${m.id}`)}>撤销</button>}</div>
          <details><summary>检查记录</summary>{m.runs.length?m.runs.slice(-5).reverse().map((run,i)=><p key={i}>{stamp(text(run.at))} · {text(run.note)}</p>):<p>尚未到检查时间。关闭网页没有持续后台服务。</p>}</details>
        </li>)}</ul>
        {greenNotifications.length>0&&<div role='region' aria-label='绿色预算提醒'>{greenNotifications.slice(-5).reverse().map(n=><p key={n.id}><strong>{n.title}</strong>：{text(n.body)}</p>)}</div>}
      </section>}
      <section className='panel tasks-card' aria-labelledby='tasks-reserves-title'>
      <div className='panel-head'><h2 id='tasks-reserves-title'>已预留的预算资金</h2><span className='status'>{goals.length} 项</span></div>
      <p className='tasks-card-intro'>查看生日、出行等预算的预留金额，以及执行或释放状态。</p>
      {goals.length === 0 ? <p className='empty'>暂无资金预留记录。</p> : (
        <ul className='task-list'>
          {goals.map((goal, index) => {
            const record = isRecord(goal) ? goal : {};
            const reserved = text(record.status) === 'reserved' ? cents(record.amountCents) : 0;
            const target = cents(record.targetCents) ?? cents(record.amountCents);
            return (
              <li key={text(record.id, `goal-${index}`)}>
                <strong>{text(record.title, text(record.name, `目标 ${index + 1}`))}</strong>
                <span>{({reserved:'已预留',released:'已释放',spent:'已执行并释放余款',cancelled:'已撤销',failed:'失败，预算已释放',pending:'待处理',pending_review:'待审核'} as Record<string,string>)[text(record.status)] ?? text(record.status)} · 当前预留 {money(reserved ?? 0)}{target === null ? '' : ` / 初始预算 ${money(target)}`}</span>
                {record.type==='reserve'&&record.status==='reserved'&&<button type='button' className='button btn-secondary' disabled={busy} onClick={()=>void send(`释放预算${text(record.id)}`)}>核对并释放预留</button>}
              </li>
            );
          })}
        </ul>
      )}
      </section>
      <section className='panel tasks-card' aria-labelledby='tasks-orders-title'>
      <div className='panel-head'><h2 id='tasks-orders-title'>预约购买记录</h2><span className='status'>{orders.length} 笔</span></div>
      <p className='tasks-card-intro'>生日鲜花、蛋糕等预约执行后，商品明细与模拟购买金额会保存在这里。不会向真实商户下单。</p>
      {orders.length === 0 ? <p className='empty'>暂无购买记录，预约执行后可在此查看。</p> : (
        <ul className='task-list'>
          {orders.map((order, index) => {
            const record = isRecord(order) ? order : {};
            const items = Array.isArray(record.items) ? record.items.map(itemLabel).filter(Boolean) : [];
            const total = cents(record.totalCents);
            return (
              <li key={text(record.id, `order-${index}`)}>
                <div className='section-head'>
                  <strong>{text(record.title, text(record.name, `订单 ${index + 1}`))}</strong>
                  <span className='status'>{text(record.status) === 'placed' ? '已模拟下单' : text(record.status, '未标注')}</span>
                </div>
                <p>{items.length > 0 ? items.join('、') : '暂无商品明细'}</p>
                <span>{total === null ? '金额未记录' : money(total)}</span>
              </li>
            );
          })}
        </ul>
      )}
      </section>

    </div>
  );
}
