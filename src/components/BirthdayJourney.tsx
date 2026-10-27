import { day, money } from '../api';
import type { BankState, Schedule } from '../types';

type Props = {
  state: BankState;
  schedule: Schedule;
  onEdit: () => void;
  onCards?: () => void;
};

const STATUS: Record<string, string> = {
  pending: '待确认', scheduled: '已排期', confirmed: '已排期', running: '执行中',
  executed: '已执行', completed: '已完成', succeeded: '已完成', success: '已完成',
  failed: '失败', cancelled: '已取消', canceled: '已取消',
  awaiting_confirmation: '条件变化，待重新授权',
};

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;
const amount = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const date = (value?: string, withTime=false): string => {
  if (!value) return '未记录';
  if(Number.isNaN(new Date(value).getTime()))return value;
  return withTime?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):day(value);
};

export function BirthdayJourney({ state, schedule, onEdit, onCards }: Props) {
  const params = schedule.params ?? {};
  const eventDate = text(params.eventDate);
  const items = Array.isArray(params.items)
    ? params.items.map((raw) => {
        const item = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        const price=amount(item.priceCents)??amount(item.amountCents);
        return { name: text(item.name) ?? text(item.title), cents: price===undefined?undefined:price*(amount(item.quantity)??1) };
      })
    : [];
  const itemSum = items.length > 0 && items.every((item) => item.cents !== undefined)
    ? items.reduce((sum, item) => sum + (item.cents ?? 0), 0) : undefined;
  const total = amount(params.totalCents) ?? amount(params.total) ?? itemSum;

  const goal = state.goals.find((entry) => entry?.scheduleId === schedule.id);
  const order = state.orders?.find((entry) => entry?.scheduleId === schedule.id);
  const receipt = schedule.receipt;
  const transactionIds = receipt?.transactionIds ?? [];
  const goalStatus = text(goal?.status);
  const budget = amount(goal?.amountCents);
  const reserved = goalStatus==='reserved'?budget:['spent','cancelled','failed'].includes(goalStatus??'')?0:undefined;
  const paid = order?.status==='placed'?amount(order.totalCents):undefined;
  const unspent = goalStatus==='spent'&&budget!==undefined&&paid!==undefined&&budget>=paid?budget-paid:undefined;
  const auth = schedule as Schedule & { authorizationReceiptId?: string; authorizedByPlanId?: string };
  const authReceipt = text(auth.authorizationReceiptId);
  const authPlan = text(auth.authorizedByPlanId);
  const failed = schedule.status === 'failed';
  const completed = ['executed','completed', 'succeeded', 'success'].includes(schedule.status);
  const cancelled = ['cancelled', 'canceled'].includes(schedule.status);

  return (
    <section className='birthday-journey' aria-label={schedule.title}>
      <header className='birthday-journey__head'>
        <div>
          <p className='panel-meta'>生日任务 · 沙盒演示</p>
          <h3 className='birthday-journey__title'>{schedule.title}</h3>
        </div>
        <span className='status birthday-journey__status' data-status={schedule.status}>
          {STATUS[schedule.status] ?? schedule.status}
        </span>
      </header>
      <p className='birthday-journey__note panel-meta'>
        固定商品与合成数据；生日日期来自任务参数，不扫描联系人或日历。
      </p>

      <ol className='task-list birthday-journey__story'>
        <li>
          <span className='birthday-journey__label'>生日日期</span>
          <span>{date(eventDate)} <span className='panel-meta'>（由你提供）</span></span>
        </li>
        <li>
          <span className='birthday-journey__label'>授权</span>
          <span>
            {authReceipt ? <>凭证 <code>{authReceipt}</code></> : authPlan ? <>确认计划 <code>{authPlan}</code></> : '未记录（旧数据可能缺少授权字段），请核对任务来源。'}
            {authReceipt && authPlan ? <> · 计划 <code>{authPlan}</code></> : null}
          </span>
        </li>
        <li>
          <span className='birthday-journey__label'>预算预留</span>
          <span>
            {goal ? (
              <>
                {budget !== undefined ? `预算 ${money(budget)}` : '预算金额未记录'}
                {reserved !== undefined ? ` · 已预留 ${money(reserved)}` : goal?.reserved === true ? ' · 已标记预留' : ''}
                {goalStatus ? ` · ${({reserved:'已预留',spent:'已支付并释放预留',failed:'失败，预算已释放',cancelled:'取消，预算已释放'} as Record<string,string>)[goalStatus]??goalStatus}` : ' · 目标状态未记录'}
              </>
            ) : '未找到关联预算记录，无法核对预留。'}
          </span>
        </li>
        <li>
          <span className='birthday-journey__label'>商品与金额</span>
          <span>
            {items.length > 0
              ? items.map((item, index) => (
                  <span key={`${item.name ?? 'item'}-${index}`}>
                    {index > 0 ? ' + ' : ''}
                    {item.name ?? '商品'} {item.cents !== undefined ? money(item.cents) : '（金额未记录）'}
                  </span>
                ))
              : '商品明细未记录'}
            {total !== undefined ? <> · 合计 {money(total)}</> : null}
          </span>
        </li>
        <li>
          <span className='birthday-journey__label'>计划执行</span>
          <span>{date(schedule.executeAt,true)} <span className='panel-meta'>（演示到点需手动推进测试时钟）</span></span>
        </li>
        <li>
          <span className='birthday-journey__label'>订单</span>
          <span>{order ? <>已匹配订单 <code>{text(order.id) ?? '单号未记录'}</code></> : '未记录匹配订单'}</span>
        </li>
        <li>
          <span className='birthday-journey__label'>执行凭证</span>
          <span>
            {receipt ? (
              <>凭证 <code>{receipt.id}</code> · 流水 {transactionIds.length > 0 ? transactionIds.join('、') : '未记录'}</>
            ) : completed ? '未记录执行凭证，请核对任务详情。' : '尚未执行，无执行凭证。'}
          </span>
        </li>
      </ol>

      <p className='birthday-journey__settle panel-meta'>
        {unspent!==undefined?`已实付 ${money(paid!)}，预留预算已结束；未使用的 ${money(unspent)} 已回到可用资金。`:
          ['failed','cancelled'].includes(goalStatus??'')&&budget!==undefined?`整笔预留预算 ${money(budget)} 已释放。`:
          '到期成功后扣除订单金额并释放余下预算；失败或取消时释放整笔预留，实际结果以关联预算与凭证为准。'}
      </p>

      {failed ? (
        <div className='birthday-journey__alert' role='alert'>
          <p><strong>执行失败</strong>：{schedule.error?.trim() || '失败原因未记录，请核对任务详情。'}</p>
          <div className='birthday-journey__actions'>
            <button type='button' onClick={onEdit}>调整后重新安排</button>
            {onCards ? <button type='button' onClick={onCards}>检查卡片</button> : null}
          </div>
          <p className='panel-meta'>不会重试旧日期或自动改期；需明确确认新计划。</p>
        </div>
      ) : null}

      {cancelled ? (
        <p className='birthday-journey__note panel-meta'>任务已取消，不会自动重试；重新安排需明确确认。</p>
      ) : null}

      <p className='birthday-journey__foot panel-meta'>
        由手动推进的演示时钟到期触发模拟环境执行，不会向真实商户购买。取消或新建计划仍需确认。
      </p>
    </section>
  );
}
