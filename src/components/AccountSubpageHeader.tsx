import { ArrowLeft, CreditCard, Landmark, LineChart, ShieldCheck } from 'lucide-react';
import { money } from '../api';
import type { BankState, Route } from '../types';

const ACCOUNT_PAGE_META: Partial<Record<Route, {
  title: string;
  hint: string;
  icon: typeof CreditCard;
}>> = {
  wealth: {
    title: '理财',
    hint: '风险评估、产品比较与模拟持仓',
    icon: LineChart,
  },
  transfers: {
    title: '转账收款',
    hint: '联系人转账、AA 收款与预约',
    icon: Landmark,
  },
  funding: {
    title: '存入与转出',
    hint: '本人合成卡与本账户之间互转',
    icon: ShieldCheck,
  },
  cards: {
    title: '银行卡管理',
    hint: '额度、锁定、挂失与模拟申请',
    icon: CreditCard,
  },
};

interface AccountSubpageHeaderProps {
  route: Route;
  state: BankState;
  onBack: () => void;
}

export function AccountSubpageHeader({ route, state, onBack }: AccountSubpageHeaderProps) {
  const page = ACCOUNT_PAGE_META[route];
  if (!page) return null;
  const Icon = page.icon;
  const availableCents = state.account.balanceCents - state.account.reservedCents;

  return (
    <section className="account-subpage-head" aria-label="账户服务导航">
      <button className="account-back-button" type="button" onClick={onBack}>
        <ArrowLeft size={17} />
        <span>返回账户首页</span>
      </button>

      <div className="account-subpage-context">
        <span className="account-subpage-icon"><Icon size={18} /></span>
        <div>
          <span>账户服务</span>
          <strong>{page.title}</strong>
          <small>{page.hint}</small>
        </div>
      </div>

      <div className="account-subpage-balance">
        <span>可用余额</span>
        <strong>{money(availableCents)}</strong>
      </div>
    </section>
  );
}
