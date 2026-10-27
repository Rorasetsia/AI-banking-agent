import { useId, useState } from 'react';
import {
  ArrowDownUp,
  ArrowLeftRight,
  ChevronRight,
  CreditCard,
  Eye,
  EyeOff,
  Leaf,
  LineChart,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { money } from '../api';
import type { PageProps } from '../types';
import './AccountHome.css';
import { InvestmentArtwork } from './InvestmentArtwork';

function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
  });
}

export function AccountHome({ state, navigate }: PageProps) {
  const [visible, setVisible] = useState(true);
  const contourId = `account-crown-${useId().replace(/:/g, '')}`;
  const ownCards = state.ownCards ?? [];
  const products = new Map(state.products.map(product => [product.id, product]));
  const holdingsCents = (state.holdings ?? []).reduce((total, holding) => {
    const product = products.get(holding.productId);
    return total + Math.round(holding.shares * (product?.unitPriceCents ?? 100));
  }, 0);
  const availableCents = state.account.balanceCents - state.account.reservedCents;
  const reveal = (cents: number) => visible ? money(cents) : '••••••';
  const recent = state.transactions.slice(-4).reverse();

  const openRoute = (route: Parameters<NonNullable<PageProps['navigate']>>[0]) => {
    navigate?.(route);
  };

  return (
    <div className="account-home">
      <section className="account-wallet-stack" aria-labelledby="account-wallet-title">
        <div className="account-wallet-card">
          <svg className="account-contour-defs" aria-hidden="true" focusable="false" width="0" height="0">
            <defs><clipPath id={contourId} clipPathUnits="objectBoundingBox">
              <path d="M.025,0 H.975 Q1,0 1,.12 V.88 Q1,1 .975,1 H.60 C.53,1 .51,.75 .44,.75 H.025 Q0,.75 0,.63 V.12 Q0,0 .025,0 Z" />
            </clipPath></defs>
          </svg>
          <div className="account-wallet-crown">
            <div className="account-crown-edge" style={{ clipPath: `url(#${contourId})` }} aria-hidden="true" />
            <div className="account-crown-surface" style={{ clipPath: `url(#${contourId})` }} aria-hidden="true" />
            <div className="account-brand-sign"><span><Leaf size={25} strokeWidth={1.5} aria-hidden="true" /></span><div><strong>小苔</strong><small>AI BANKING</small></div></div>
            <div className="account-wallet-balance">
              <div className="account-wallet-label-row"><span>可用余额</span>
                <button
                  type="button"
                  className="account-eye"
                  aria-label={visible ? '隐藏账户金额' : '显示账户金额'}
                  onClick={() => setVisible(value => !value)}
                >
                  {visible ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>
              </div>
              <div className="account-wallet-amount-row"><strong>{reveal(availableCents)}</strong></div>
            </div>
          </div>

          <header className="account-wallet-head">
            <div><h2 id="account-wallet-title">{state.account.name}</h2><span className="account-wallet-tag">合成数据 · 模拟交易</span></div>
            <span className="account-brand-badge"><ShieldCheck size={13} aria-hidden="true" /> 独立银行模拟环境</span>
          </header>
          <dl className="account-wallet-meta">
              <div><dt>活期余额</dt><dd>{reveal(state.account.balanceCents)}</dd></div>
              <div><dt>已预留</dt><dd>{reveal(state.account.reservedCents)}</dd></div>
              <div><dt>资产估值</dt><dd>{reveal(state.account.balanceCents + holdingsCents)}</dd></div>
          </dl>

          <div className="account-quick-actions" aria-label="账户快捷操作">
            <button type="button" onClick={() => openRoute('transfers')}>
              <span className="account-action-icon"><ArrowLeftRight size={21} aria-hidden="true" /></span>
              <span>转账收款</span>
            </button>
            <button type="button" onClick={() => openRoute('funding')}>
              <span className="account-action-icon"><ArrowDownUp size={21} aria-hidden="true" /></span>
              <span>存入转出</span>
            </button>
            <button type="button" onClick={() => openRoute('cards')}>
              <span className="account-action-icon"><CreditCard size={21} aria-hidden="true" /></span>
              <span>银行卡</span>
            </button>
          </div>
        </div>
      </section>

      <div className="account-overview-grid">
        <section className="panel account-mini-card account-mini-card--wealth">
          <div className="account-mini-head">
            <span className="account-mini-icon"><LineChart size={18} /></span>
            <div>
              <h3>理财账户</h3>
              <p>用于投资 · 查看产品与持仓</p>
            </div>
          </div>
          <strong className="account-mini-value">{reveal(holdingsCents)}</strong>
          <p className="investment-purpose">了解风险，选择产品，管理你的模拟投资。</p>
          <InvestmentArtwork />
          <div className="account-mini-foot">
            <span>持仓 {(state.holdings ?? []).length} 项</span>
            <button type="button" onClick={() => openRoute('wealth')}>
              查看投资 <ChevronRight size={14} />
            </button>
          </div>
        </section>

        <section className="panel account-mini-card">
          <div className="account-mini-head">
            <span className="account-mini-icon"><Wallet size={18} /></span>
            <div>
              <h3>我的银行卡</h3>
              <p>本人合成卡与用卡管理</p>
            </div>
          </div>
          <div className="account-bank-stack" aria-label="本人银行卡摘要">
            {ownCards.length === 0 ? (
              <p className="account-muted">暂无本人绑定卡。</p>
            ) : ownCards.slice(0, 2).map(card => (
              <div className="account-bank-row" key={card.id}>
                <span className="account-bank-dot" aria-hidden="true" />
                <div>
                  <strong>{card.name}</strong>
                  <small>尾号 {card.last4} · {reveal(card.balanceCents)}</small>
                </div>
              </div>
            ))}
          </div>
          <div className="account-mini-foot">
            <span>{ownCards.length} 张本人卡</span>
            <button type="button" onClick={() => openRoute('cards')}>
              卡片管理 <ChevronRight size={14} />
            </button>
          </div>
        </section>
      </div>

      <section className="panel account-recent-panel">
        <div className="panel-head">
          <h2>最近流水</h2>
          <button className="text-link-button" type="button" onClick={() => openRoute('bills')}>
            查看全部 <ChevronRight size={14} />
          </button>
        </div>
        {recent.length === 0 ? (
          <p className="empty">还没有流水记录。</p>
        ) : (
          <ul className="account-recent-list">
            {recent.map(item => (
              <li key={item.id}>
                <span className="account-recent-date">{shortDate(item.date)}</span>
                <div>
                  <strong>{item.merchant}</strong>
                  <small>{item.category}</small>
                </div>
                <span className={item.amountCents >= 0 ? 'account-recent-amount is-in' : 'account-recent-amount'}>
                  {item.amountCents >= 0 ? '+' : ''}{money(item.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
