import type { Route } from '../types';
import {
  ClipboardList,
  LayoutDashboard,
  Leaf,
  Menu,
  ReceiptText,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react';

type NavIcon = typeof LayoutDashboard;

export type PrimaryGroup = {
  id: string;
  label: string;
  icon: NavIcon;
  defaultRoute: Route;
  routes: readonly { route: Route; label: string; hint?: string }[];
};

type NavigationProps = {
  route: Route;
  onNavigate: (route: Route) => void;
};

export const PRIMARY_GROUPS: readonly PrimaryGroup[] = [
  { id: 'overview', label: '总览', icon: LayoutDashboard, defaultRoute: 'overview',
    routes: [{ route: 'overview', label: '总览' }] },
  { id: 'assistant', label: 'AI助手', icon: Sparkles, defaultRoute: 'assistant',
    routes: [{ route: 'assistant', label: 'AI助手' }] },
  { id: 'green', label: '绿色金融', icon: Leaf, defaultRoute: 'green',
    routes: [{ route: 'green', label: '绿色金融' }] },
  { id: 'accounts', label: '账户服务', icon: Wallet, defaultRoute: 'accounts',
    routes: [
      { route: 'accounts', label: '账户首页' },
      { route: 'transfers', label: '转账收款' },
      { route: 'funding', label: '存入转出' },
      { route: 'cards', label: '银行卡' },
      { route: 'wealth', label: '理财' },
    ] },
  { id: 'billing', label: '账单与扣费', icon: ReceiptText, defaultRoute: 'bills',
    routes: [
      { route: 'bills', label: '账单洞察', hint: '历史流水、收支统计与导出' },
      { route: 'subscriptions', label: '订阅与代扣', hint: '授权管理、下次扣费与取消方案' },
      { route: 'mandates', label: '扣费监测', hint: '有限监测、异常核对与争议草稿' },
    ] },
  { id: 'tasks', label: '预约与凭证', icon: ClipboardList, defaultRoute: 'tasks',
    routes: [{ route: 'tasks', label: '预约与凭证' }] },
  { id: 'family', label: '家庭提醒', icon: Users, defaultRoute: 'family',
    routes: [{ route: 'family', label: '家庭提醒' }] },
];

export function getPrimaryGroup(route: Route): PrimaryGroup | undefined {
  return PRIMARY_GROUPS.find((group) =>
    group.routes.some((item) => item.route === route),
  );
}

export function PrimaryNavigation({ route, onNavigate }: NavigationProps) {
  const current = getPrimaryGroup(route);

  return (
    <nav className="sidebar-nav" aria-label="工作台主导航">
      {PRIMARY_GROUPS.map((group) => {
        const isActive = current?.id === group.id;
        const Icon = group.icon;
        return (
          <button
            key={group.id}
            type="button"
            className={isActive ? 'nav-item is-active' : 'nav-item'}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onNavigate(group.defaultRoute)}
          >
            <Icon size={18} aria-hidden />
            <span>{group.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function PageSubnavigation({ route, onNavigate }: NavigationProps) {
  const group = getPrimaryGroup(route);
  if (!group || group.routes.length < 2) return null;
  if (group.id === 'accounts') return null;

  return (
    <nav className="page-subnav" aria-label={`${group.label}分类`}>
      {group.routes.map((item) => {
        const isActive = item.route === route;
        return (
          <button
            key={item.route}
            type="button"
            className={isActive ? 'page-subnav-item is-active' : 'page-subnav-item'}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onNavigate(item.route)}
          >
            <span className="page-subnav-copy">
              <strong>{item.label}</strong>
              {item.hint ? <small>{item.hint}</small> : null}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

type MobileItem = {
  id: string;
  label: string;
  icon: NavIcon;
  routes: readonly Route[];
  target: Route | null;
};

const MOBILE_ITEMS: readonly MobileItem[] = [
  { id: 'overview', label: '总览', icon: LayoutDashboard, routes: ['overview'], target: 'overview' },
  { id: 'assistant', label: 'AI助手', icon: Sparkles, routes: ['assistant'], target: 'assistant' },
  { id: 'accounts', label: '账户', icon: Wallet,
    routes: ['accounts', 'transfers', 'funding', 'cards', 'wealth'], target: 'accounts' },
  { id: 'billing', label: '账单', icon: ReceiptText,
    routes: ['bills', 'subscriptions', 'mandates'], target: 'bills' },
  { id: 'more', label: '更多', icon: Menu,
    routes: ['tasks', 'family', 'security', 'settings', 'green'], target: null },
];

type MobileNavigationProps = NavigationProps & {
  onMore: () => void;
  moreOpen: boolean;
};

export function MobileNavigation({
  route,
  onNavigate,
  onMore,
  moreOpen,
}: MobileNavigationProps) {
  return (
    <nav className="mobile-nav mobile-nav--compact" aria-label="移动端主导航">
      {MOBILE_ITEMS.map((item) => {
        const Icon = item.icon;
        const isMore = item.target === null;
        const isActive =
          item.routes.includes(route) || (isMore && moreOpen);
        return (
          <button
            key={item.id}
            type="button"
            className={isActive ? 'mobile-nav-item is-active' : 'mobile-nav-item'}
            aria-current={!isMore && isActive ? 'page' : undefined}
            aria-expanded={isMore ? moreOpen : undefined}
            aria-controls={isMore ? 'workspace-sidebar' : undefined}
            onClick={() => (item.target === null ? onMore() : onNavigate(item.target))}
          >
            <Icon size={18} aria-hidden />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
