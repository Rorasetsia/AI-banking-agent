import {FeatureEntry} from './FeatureEntry';
import { useState, type FormEvent } from 'react';
import { money } from '../api';
import type { PageProps } from '../types';

const stamp = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
const text = (value: unknown) => typeof value === 'string' ? value : '';
const transactionTime = (value: string) => {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
};

export function MandatesAndCharges({ state, send, busy, navigate }: PageProps) {
  const billingMandates=(state.mandates??[]).filter(m=>m.scope!=='green_transport_watch');
  const billingNotifications=(state.notifications??[]).filter(n=>n.kind!=='green_budget');
  const [scope, setScope] = useState('subscription');
  const [days, setDays] = useState('30');
  const [interval, setInterval] = useState('1');
  const [threshold, setThreshold] = useState('3000');
  const [excluded, setExcluded] = useState<string[]>([]);
  const [transactionId, setTransactionId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [disputeEntryKey,setDisputeEntryKey]=useState(0);
  const submit = async (request: string) => {
    setError(''); setSending(true);
    try { await send(request); } catch (e) { setError(e instanceof Error ? e.message : '未生成方案。'); } finally { setSending(false); }
  };
  const create = (event: FormEvent) => {
    event.preventDefault();
    if (!/^[0-9]+$/.test(days) || Number(days) < 1 || Number(days) > 90 || !/^[0-9]+$/.test(interval) || Number(interval) < 1 || Number(interval) > 30 || (scope === 'bill' && (!/^[0-9]+(?:[.][0-9]{1,2})?$/.test(threshold) || Number(threshold) < 1 || Number(threshold) > 1000000))) { setError('有效期1—90天，检查间隔1—30天，阈值1—1,000,000元且最多两位小数。'); return; }
    void submit(`创建${scope === 'subscription' ? '订阅' : '账单'}监测委托，有效期${days}天，每${interval}天检查，金额阈值${scope==='bill'?threshold:'3000'}元${excluded.length ? `，排除${excluded.join('、')}` : ''}`);
  };
  const prepareDispute = (id: string) => {
    setTransactionId(id);setDisputeEntryKey(key=>key+1);
    setTimeout(() => {
      if (typeof document !== 'undefined') {
        document.getElementById('charge-dispute-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 0);
  };

  const expenseTransactions = state.transactions.filter(t => t.amountCents < 0);
  const recentExpenses = expenseTransactions
    .slice()
    .sort((a, b) => transactionTime(b.date) - transactionTime(a.date))
    .slice(0, 40);
  const selectedExpense = transactionId ? expenseTransactions.find(t => t.id === transactionId) : undefined;
  const disputeExpenses = selectedExpense && !recentExpenses.some(t => t.id === selectedExpense.id)
    ? [selectedExpense, ...recentExpenses]
    : recentExpenses;
  const disabled = busy || sending;
  return <div className='monitor-grid'>
    <section className='panel monitor-card monitor-card--wide' aria-labelledby='monitor-create-title'>
    <div className='section-head'>
      <div>
        <h2 id='monitor-create-title'>设置扣费提醒</h2>
        <p>选择要关注的扣费、提醒金额与检查频率。</p>
      </div>
    </div>

    <FeatureEntry title="设置扣费提醒" description="选择监测范围，再设置频率与提醒条件。"><form className='form-grid' onSubmit={create}>
      <label className='field'><span>监测范围</span><select aria-label='监测范围' value={scope} onChange={e => setScope(e.target.value)}><option value='subscription'>订阅涨价与续费</option><option value='bill'>账单大额与重复扣款</option></select></label>
      <label className='field'><span>有效天数</span><input inputMode='numeric' value={days} onChange={e => setDays(e.target.value)} /></label>
      <label className='field'><span>每几天检查</span><input inputMode='numeric' value={interval} onChange={e => setInterval(e.target.value)} /></label>
      {scope==='bill'&&<label className='field'><span>账单金额提醒线（元）</span><input inputMode='decimal' value={threshold} onChange={e => setThreshold(e.target.value)} /></label>}
      <fieldset className='exclusion-fields'><legend>不纳入监测的订阅</legend>{state.subscriptions.map(sub => <label key={sub.id}><input type='checkbox' checked={excluded.includes(sub.name)} onChange={e => setExcluded(old => e.target.checked ? [...old, sub.name] : old.filter(n => n !== sub.name))} /> {sub.name}</label>)}</fieldset>
      <button type='submit' className='button button--primary' disabled={disabled}>生成监测方案</button>
    </form></FeatureEntry>
    {error && <p role='alert'>{error}</p>}
    <details className='monitor-help'><summary>提醒如何工作</summary><p>订阅提醒关注涨价与3天内续费；金额提醒线用于账单大额检查。打开页面或推进模拟时间时检查，关闭网页后不会持续检查。提醒不会自动取消订阅或操作资金。</p></details>
    {navigate && <div className='plan-actions'><button type='button' className='button button--ghost' onClick={() => navigate('subscriptions')}>前往订阅与代扣</button></div>}

    </section>
    <section className='panel monitor-card' aria-labelledby='monitor-rules-title'>
    <div className='panel-head'><h2 id='monitor-rules-title'>我的提醒规则</h2><span className='status'>{billingMandates.length} 项</span></div>
    <ul className='task-list'>{billingMandates.map(m => <li key={m.id}><strong>{m.title}</strong><p>状态：{({ active:'监测中', paused:'已暂停', revoked:'已撤销', expired:'已到期' } as Record<string,string>)[m.status] ?? m.status} · 到期 {stamp(m.expiresAt)}</p><p>下次检查 {stamp(m.nextRunAt)} · 提醒线 {money(m.thresholdCents)}</p><p>排除：{(m.excludedSubscriptionIds ?? []).map(id => state.subscriptions.find(s => s.id === id)?.name ?? '原订阅').join('、') || '无'}</p>
      <div className='plan-actions'>{m.status === 'active' && <button type='button' className='button button--ghost' disabled={disabled} onClick={() => void submit(`暂停委托${m.id}`)}>暂停</button>}{m.status === 'paused' && <button type='button' className='button button--ghost' disabled={disabled} onClick={() => void submit(`恢复委托${m.id}`)}>恢复</button>}{['active','paused','expired'].includes(m.status) && <button type='button' className='button button--ghost' disabled={disabled} onClick={() => void submit(`撤销委托${m.id}`)}>撤销</button>}</div>
      <details><summary>检查记录</summary>{m.runs.length ? m.runs.slice(-5).reverse().map((r, i) => <p key={i}>{stamp(text(r.at))} · {text(r.note)}</p>) : <p>尚未到检查时间。</p>}</details>
    </li>)}</ul>{!billingMandates.length && <p>尚未创建委托。也可以在对话中说“每月检查订阅，涨价提醒我，别动云盘”。</p>}

    </section>
    <section className='panel monitor-card' aria-labelledby='monitor-notices-title'>
    <div className='panel-head'><h2 id='monitor-notices-title'>发现的扣费线索</h2><span className='status'>{billingNotifications.length} 条</span></div>
    <ul className='task-list'>{billingNotifications.slice(-20).reverse().map(n => {
      const kind = text(n.kind);
      const refId = text(n.refId);
      const linkedExpense = refId ? state.transactions.find(t => t.id === refId && t.amountCents < 0) : undefined;
      return <li key={n.id} data-kind={kind || undefined}><strong>{n.title}</strong><p>{text(n.body) || text(n.message) || '暂无补充说明。'}</p>{linkedExpense && <div className='plan-actions'><button type='button' className='button button--ghost' onClick={() => prepareDispute(linkedExpense.id)}>用此流水整理草稿</button></div>}</li>;
    })}</ul>{!billingNotifications.length && <p>暂时没有需要核对的扣费提醒。</p>}

    </section>
    <section className='panel monitor-card monitor-card--wide' aria-labelledby='monitor-dispute-title'>
    <div className='section-head'>
      <div>
        <h2 id='monitor-dispute-title'>核对一笔可疑扣费</h2>
        <p>选一笔支出，说明疑问，小苔会帮你整理核对草稿。</p>
      </div>
      <button type='button' className='button button--ghost' disabled={disabled} onClick={() => void submit('检查重复扣款和扣费异常')}>让小苔核对扣费</button>
    </div>
    <FeatureEntry title="核对可疑扣费" description="选择一笔流水，说明需要核对的问题。" revealKey={disputeEntryKey}><form id='charge-dispute-form' className='form-grid' onSubmit={e => { e.preventDefault(); if (!transactionId || !reason.trim()) { setError('请选择流水并填写需要核对的原因。'); return; } void submit(`为 ${transactionId} 生成争议草稿：${reason.trim()}`); }}>
      <label className='field'><span>需核对的支出流水</span><select value={transactionId} onChange={e => setTransactionId(e.target.value)} required><option value=''>请选择</option>{disputeExpenses.map(t => <option key={t.id} value={t.id}>{stamp(t.date)} {t.merchant} {money(-t.amountCents)}</option>)}</select></label>
      <label className='field'><span>我的疑问</span><input value={reason} maxLength={200} onChange={e => setReason(e.target.value)} required placeholder='例如：同一订单是否重复扣费' /></label>
      <button className='button button--primary' type='submit' disabled={disabled}>生成争议草稿方案</button>
    </form></FeatureEntry>
    </section>
    <section className='panel monitor-card monitor-card--wide' aria-labelledby='monitor-drafts-title'>
    <div className='panel-head'><h2 id='monitor-drafts-title'>我的核对草稿</h2><span className='status'>未提交</span></div>
    <ul className='task-list'>{(state.disputeCases ?? []).slice(-10).reverse().map(c => <li key={text(c.id)}><strong>争议核对草稿 · 尚未提交</strong><p>{text(c.userStatement)}</p>{Array.isArray(c.facts) && c.facts.map((f, i) => <p key={i}>{text(f)}</p>)}<p className='panel-meta'>{text(c.disclaimer)}</p></li>)}</ul>{!state.disputeCases?.length && <p>暂无争议草稿。</p>}
    {navigate && <div className='plan-actions'><button type='button' className='button button--ghost' onClick={() => navigate('cards')}>前往银行卡核对</button></div>}
    <p className='panel-meta'>草稿仅供你核对，不会自动提交或申请退款。</p>
    </section>
  </div>;
}
