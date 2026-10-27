import { useState, type FormEvent } from 'react';
import { money } from '../api';
import type { PageProps } from '../types';

export function AccountFunding({ state, send, busy }: PageProps) {
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [cardId, setCardId] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const cards = state.ownCards ?? [];
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    const card = cards.find(c => c.id === cardId);
    if (!card) { setError('请选择本人已绑定的合成银行卡。'); return; }
    if (!/^\d+(?:\.\d{1,2})?$/.test(amount.trim()) || Number(amount) <= 0 || !Number.isSafeInteger(Math.round(Number(amount) * 100))) { setError('请输入大于0、最多两位小数的金额。'); return; }
    setSending(true);
    try { await send(direction === 'in' ? `从本人卡尾号${card.last4}存入${amount.trim()}元` : `转出${amount.trim()}元到本人卡尾号${card.last4}`); }
    catch (e) { setError(e instanceof Error ? e.message : '方案未生成，请重试。'); }
    finally { setSending(false); }
  };
  return <section className="panel">
    <div className="section-head"><div><h2>本人账户存入与转出</h2><p>本人名下合成银行卡与本账户之间互转，两边余额同时核对。</p></div></div>
    <div className="banking-grid"><div><small>账户活期</small><strong>{money(state.account.balanceCents)}</strong></div><div><small>预算预留</small><strong>{money(state.account.reservedCents)}</strong></div><div><small>可转出资金</small><strong>{money(state.account.balanceCents - state.account.reservedCents)}</strong></div></div>
    <ul className="task-list">{cards.map(card => <li key={card.id}><strong>{card.name} · 尾号{card.last4}</strong><p>模拟余额 {money(card.balanceCents)} · 单笔限额 {money(card.perTxLimitCents)}</p><small>本人账户 · 合成数据</small></li>)}</ul>
    <form className="form-grid" onSubmit={event => void submit(event)}>
      <label className="field"><span>互转方向</span><select value={direction} onChange={e => setDirection(e.target.value as 'in' | 'out')}><option value="in">从本人卡存入本账户</option><option value="out">从本账户转出到本人卡</option></select></label>
      <label className="field"><span>本人绑定银行卡</span><select value={cardId} onChange={e => setCardId(e.target.value)} required><option value="">请选择</option>{cards.map(card => <option key={card.id} value={card.id}>{card.name} 尾号{card.last4}</option>)}</select></label>
      <label className="field"><span>互转金额（元）</span><input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} required placeholder="例如100.00" /></label>
      <button className="button button--primary" disabled={busy || sending} type="submit">{sending ? '生成中…' : '生成互转方案'}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    <p className="panel-meta">这里只生成方案，资金操作需要核对内容、交易密码和设备双重验证。本人互转不等于收入、消费或收益；不连接真实银行，不发生真实充值。</p>
    <h3>最近互转</h3><ul className="task-list">{(state.ownFundMovements ?? []).slice(-10).reverse().map(row => <li key={row.id}><strong>{row.direction === 'in' ? '存入' : '转出'} {money(row.amountCents)}</strong><p>{new Date(row.date).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p><small className="wrap-id">流水 {row.transactionId}</small></li>)}</ul>
    {!state.ownFundMovements?.length && <p>尚无本人账户互转记录。</p>}
  </section>;
}
