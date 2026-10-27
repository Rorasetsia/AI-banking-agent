import type { BankState, PageProps } from '../types';

export function SubscriptionWatchStatus({ state, subscriptionId, navigate }: { state: BankState; subscriptionId: string; navigate?: PageProps['navigate'] }) {
  const subscription = state.subscriptions.find(item => item.id === subscriptionId);
  if (!subscription) return null;

  const active = subscription.status === 'active';
  const now = Date.parse(state.now);
  const covered = active && (state.mandates ?? []).some(mandate => {
    if (mandate.scope !== 'subscription_watch' || mandate.status !== 'active') return false;
    const expiresAt = Date.parse(mandate.expiresAt);
    if (!Number.isFinite(expiresAt) || !Number.isFinite(now) || expiresAt <= now) return false;
    return !(mandate.excludedSubscriptionIds ?? []).includes(subscriptionId);
  });
  const label = !active ? '订阅已停用' : covered ? '订阅监测中' : '未纳入有效订阅监测';
  const detail = !active
    ? '保留历史记录。'
    : covered
      ? '只读提醒，不自动取消或付款。'
      : '可设置有限期监测。';

  return <>
    <p className='panel-meta subscription-watch-status'><strong>{label}</strong> · {detail}</p>
    {navigate && <button type='button' className='subscription-watch-link' onClick={() => navigate('mandates')}>{!active || covered ? '查看扣费监测' : '设置扣费监测'}</button>}
  </>;
}
