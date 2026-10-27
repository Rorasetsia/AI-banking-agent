import {DateTimePicker} from './DateTimePicker';
import {FeatureEntry} from './FeatureEntry';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { money } from '../api';
import type { PageProps } from '../types';

function parseYuan(raw: string): number | null {
  const value = raw.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function shanghaiIso(value: string): string {
  // datetime-local is a Shanghai wall-clock value; append the offset without Date conversion.
  return `${value.slice(0, 16)}:00+08:00`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function pendingSplits(goal: Record<string, unknown>): Record<string, unknown>[] {
  const params = asRecord(goal.params);
  const nested = params && Array.isArray(params.splits) ? params.splits : [];
  const raw = Array.isArray(goal.splits) ? goal.splits : nested;
  return raw
    .map(asRecord)
    .filter((split): split is Record<string, unknown> => split !== null && split.status === 'pending');
}

export function Transfers(props: PageProps) {
  const [payee, setPayee] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [scheduled, setScheduled] = useState('');
  const [total, setTotal] = useState('');
  const [count, setCount] = useState('2');
  const [transferError, setTransferError] = useState('');
  const [aaError, setAaError] = useState('');
  const [sending, setSending] = useState(false);
  const [aaSending, setAaSending] = useState(false);

  const disabled = props.busy || sending || aaSending;
  const amountValue = parseYuan(amount);
  const totalValue = parseYuan(total);
  const countValue = Number(count);
  const countValid = Number.isInteger(countValue) && countValue >= 2 && countValue <= 20;
  const scheduledValid = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(scheduled);
  const nameCounts = props.state.contacts.reduce<Record<string, number>>((counts, contact) => {
    counts[contact.name] = (counts[contact.name] ?? 0) + 1;
    return counts;
  }, {});
  const aaGoals = props.state.goals.filter((goal) => goal.type === 'aa_request');

  async function submitTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = parseYuan(amount);
    if (!payee.trim()) {
      setTransferError('请填写收款人手机号或姓名');
      return;
    }
    if (value === null) {
      setTransferError('请输入大于 0、最多两位小数的金额');
      return;
    }
    if (scheduled && !scheduledValid) {
      setTransferError('请选择有效的定时时间');
      return;
    }
    const text = `给${payee.trim()}转${value.toFixed(2)}元，备注${memo.trim()}${scheduled ? `，定时${shanghaiIso(scheduled)}` : ''}`;
    setTransferError('');
    setSending(true);
    try {
      await props.send(text);
      setAmount('');
      setMemo('');
      setScheduled('');
    } catch (error) {
      setTransferError(error instanceof Error ? error.message : '发送失败，请重试');
    } finally {
      setSending(false);
    }
  }

  async function submitAA(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = parseYuan(total);
    if (value === null) {
      setAaError('请输入大于 0、最多两位小数的总额');
      return;
    }
    if (!countValid) {
      setAaError('人数需为 2 到 20 的整数');
      return;
    }
    setAaError('');
    setAaSending(true);
    try {
      await props.send(`${value.toFixed(2)}元${countValue}人AA`);
      setTotal('');
    } catch (error) {
      setAaError(error instanceof Error ? error.message : '发送失败，请重试');
    } finally {
      setAaSending(false);
    }
  }

  return (
    <section aria-labelledby='transfers-heading'>
      <h2 id='transfers-heading'>转账</h2>
      <p className='status'>先计划后确认，确认前不会改变余额。</p>
      <div className='form-grid'>
        <section className='panel' aria-labelledby='transfer-panel-heading'>
          <h3 id='transfer-panel-heading'>单笔转账</h3>
          <FeatureEntry title="发起单笔转账" description="选择收款人和金额，核对后再确认。"><h4>联系人</h4>
          {props.state.contacts.length === 0 ? (
            <p className='status'>暂无联系人，可直接输入手机号或姓名。</p>
          ) : (
            <ul>
              {props.state.contacts.map((contact) => (
                <li key={contact.id}>
                  <button
                    type='button'
                    className='button'
                    disabled={disabled}
                    aria-pressed={payee === contact.phone}
                    onClick={() => setPayee(contact.phone)}
                  >
                    <strong>
                      {contact.name}
                      {nameCounts[contact.name] > 1 ? `（尾号${contact.phone.slice(-4)}）` : ''}
                    </strong>
                    <span>{contact.phone}</span>
                    {contact.note ? <small>{contact.note}</small> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={submitTransfer}>
            <label className='field'>
              收款人
              <input
                value={payee}
                onChange={(event) => setPayee(event.target.value)}
                placeholder='手机号或姓名'
                disabled={disabled}
              />
            </label>
            <label className='field'>
              金额（元）
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode='decimal'
                placeholder='0.00'
                disabled={disabled}
              />
            </label>
            <details className="feature-optional"><summary>备注与预约时间（选填）</summary>            <label className='field'>
              备注
              <input
                value={memo}
                onChange={(event) => setMemo(event.target.value)}
                placeholder='例如：房租'
                disabled={disabled}
              />
            </label>
            <label className='field'>
              定时（可选）
              <DateTimePicker
                type='datetime-local'
                value={scheduled}
                onChange={setScheduled}
                disabled={disabled}
              />
            </label>
            </details>
            {amountValue !== null ? (
              <p className='status'>
                计划金额：{money(Math.round(amountValue * 100))}
                {scheduled && scheduledValid ? ` · 定时 ${shanghaiIso(scheduled)}` : ''}
              </p>
            ) : null}
            {transferError ? <p className='status' role='alert'>{transferError}</p> : null}
            <button type='submit' className='button btn-primary' disabled={disabled}>
              生成转账计划
            </button>
          </form></FeatureEntry>
        </section>

        <section className='panel' aria-labelledby='aa-panel-heading'>
          <h3 id='aa-panel-heading'>AA 收款</h3>
          <FeatureEntry title="发起AA收款" description="填写总额与人数，生成分摊方案。"><form onSubmit={submitAA}>
            <label className='field'>
              总额（元）
              <input
                value={total}
                onChange={(event) => setTotal(event.target.value)}
                inputMode='decimal'
                placeholder='0.00'
                disabled={disabled}
              />
            </label>
            <label className='field'>
              人数
              <input
                type='number'
                min={2}
                max={20}
                step={1}
                value={count}
                onChange={(event) => setCount(event.target.value)}
                disabled={disabled}
              />
            </label>
            {totalValue !== null ? (
              <p className='status'>AA 总额：{money(Math.round(totalValue * 100))}</p>
            ) : null}
            {aaError ? <p className='status' role='alert'>{aaError}</p> : null}
            <button type='submit' className='button btn-primary' disabled={disabled}>
              生成 AA 计划
            </button>
          </form></FeatureEntry>
          <h4>待收款</h4>
          {aaGoals.length === 0 ? (
            <p className='status'>暂无 AA 记录。</p>
          ) : (
            aaGoals.map((goal, index) => {
              const pending = pendingSplits(goal);
              return (
                <div className='status' key={String(goal.id ?? index)}>
                  <strong>{String(goal.title ?? 'AA 收款')}</strong>
                  <span>{pending.length > 0 ? `未到账 ${pending.length} 人` : '暂无未到账'}</span>
                  {pending.length > 0 ? (
                    <ul>
                      {pending.map((split, splitIndex) => {
                        const label = String(split.name ?? split.member ?? split.phone ?? '成员');
                        const amountCents = typeof split.amountCents === 'number' ? split.amountCents : null;
                        return (
                          <li key={String(split.id ?? splitIndex)}>
                            {label}
                            {amountCents !== null ? ` ${money(amountCents)}` : ''} · 未到账
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
              );
            })
          )}
        </section>
      </div>
    </section>
  );
}
