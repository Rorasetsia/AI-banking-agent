import { useState } from 'react';
import type { FormEvent } from 'react';
import type { PageProps, Product } from '../types';
import { api, money } from '../api';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import questionnaire from '../../shared/risk-questionnaire.json';
import { RiskAssessment } from './RiskAssessment';
import './Wealth.css';

type Draft = { amount: string; shares: string };
type Note = { tone: 'ok' | 'error'; text: string };
const emptyAnswers = () => Array<number | null>(questionnaire.questions.length).fill(null);
const dateText = (iso: string) => new Date(iso).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
const sharesText = (shares: number) => shares.toLocaleString('zh-CN', { maximumFractionDigits: 4 });

const FUND_INFO: Record<string, { category: string; warning: string }> = {
  'product-cash': { category: '货币市场基金', warning: '货币市场基金不等于银行存款，不保证本金，收益随市场变化。' },
  'product-bond': { category: '债券型基金', warning: '债券基金净值可能波动，存在信用、利率与流动性风险，可能亏损。' },
  'product-growth': { category: '股票型基金', warning: '股票型基金净值波动较大，存在行业集中风险，本金可能出现较大亏损。' },
};
const activeDebitCards = (state: PageProps['state']) => state.cards.filter(card => card.type === 'debit' && card.status === 'active');

export function Wealth({ state, send, busy, refresh, askAssistant }: PageProps) {
  const risk = state.risk;
  const currentRisk = risk?.questionnaireVersion === questionnaire.version && Number.isFinite(Date.parse(risk.assessedAt)) && Date.parse(state.now)-Date.parse(risk.assessedAt)>=0 && Date.parse(state.now)-Date.parse(risk.assessedAt)<=365*86400000;
  const savingsContext=state.savingsAgent?.draft?.active && state.savingsAgent.draft.input.targetCents ? state.savingsAgent.draft : null;
  const [showQuiz, setShowQuiz] = useState(false);
  const [answers, setAnswers] = useState<(number | null)[]>(emptyAnswers);
  const [riskBusy, setRiskBusy] = useState(false);
  const [riskError, setRiskError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const [cards, setCards] = useState<Record<string, string>>({});
  const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});
  const [sending, setSending] = useState<{ id: string; kind: 'buy' | 'sell' } | null>(null);
  const holdings = new Map(state.holdings.map((holding) => [holding.productId, holding.shares]));
  const complete = answers.length === questionnaire.questions.length && answers.every((value) => typeof value === 'number');
  const debitCards = activeDebitCards(state);

  function setDraft(id: string, patch: Partial<Draft>) {
    setDrafts(prev => ({ ...prev, [id]: { ...(prev[id] ?? { amount: '', shares: '' }), ...patch } }));
  }
  function setNote(id: string, tone: Note['tone'], text: string) { setNotes(prev => ({ ...prev, [id]: { tone, text } })); }

  async function submitRisk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (riskBusy) return;
    if (!complete) { setRiskError(`请完成全部 ${questionnaire.questions.length} 题后再提交。`); return; }
    setRiskBusy(true); setRiskError('');
    try { await api.risk(answers.filter((value): value is number => value !== null)); await refresh(); setAnswers(emptyAnswers()); setShowQuiz(false); }
    catch (error) { setRiskError(error instanceof Error ? error.message : '评估失败，请稍后重试。'); }
    finally { setRiskBusy(false); }
  }

  async function trade(product: Product, kind: 'buy' | 'sell') {
    const draft = drafts[product.id] ?? { amount: '', shares: '' };
    let text: string;
    if (kind === 'buy') {
      if (!risk || !currentRisk || risk.level < product.riskLevel) { setNote(product.id, 'error', !currentRisk ? '请先完成新版12题风险评估。' : `当前演示适当性档位不足，需要 R${product.riskLevel}。`); return; }
      if (!acknowledged[product.id]) { setNote(product.id, 'error', '请先阅读并勾选申购风险告知。'); return; }
      const card = debitCards.find(item => item.id === (cards[product.id] ?? debitCards[0]?.id));
      if (!card) { setNote(product.id, 'error', '没有可用的正常借记卡，请先检查卡片状态。'); return; }
      const raw = draft.amount.trim();
      if (!/^\d+(\.\d{1,2})?$/.test(raw) || Number(raw) <= 0) { setNote(product.id, 'error', '请输入大于 0 的金额，最多两位小数。'); return; }
      text = `使用尾号${card.last4}的借记卡申购${Number(raw).toFixed(2)}元${product.name}`;
    } else {
      const raw = draft.shares.trim();
      if (!/^\d+$/.test(raw) || Number(raw) <= 0) { setNote(product.id, 'error', '请输入大于 0 的整数份额。'); return; }
      text = `赎回${product.name}${Number(raw)}份`;
    }
    setSending({ id: product.id, kind });
    try {
      await send(text);
      setNote(product.id, 'ok', kind === 'buy' ? '待确认申购方案已生成，请再次核对产品、金额、银行卡和风险提示。' : '赎回指令已提交，请在对话中核对待确认方案。');
      setDraft(product.id, kind === 'buy' ? { amount: '' } : { shares: '' });
    } catch (error) { setNote(product.id, 'error', error instanceof Error ? error.message : '发送失败，请重试。'); }
    finally { setSending(null); }
  }

  if (showQuiz) return <RiskAssessment answers={answers} onAnswer={(index, value) => { setAnswers(prev => prev.map((answer, i) => i === index ? value : answer)); setRiskError(''); }} onSubmit={submitRisk} onBack={() => { setShowQuiz(false); setRiskError(''); }} busy={riskBusy} error={riskError} previousLevel={risk?.level} />;

  return <>
    {savingsContext && <section className="wealth-goal-return" aria-label="继续存钱目标"><div><strong>你的存钱目标还在这里</strong><p>完成评估后，回到同一个目标查看候选产品、本金安排与收益情景。</p></div><button type="button" disabled={busy || !askAssistant} onClick={() => currentRisk ? askAssistant?.('继续这份储蓄计划，结合风险评估比较理财') : setShowQuiz(true)}>{currentRisk?'回到存钱目标，更新测算':'先完成风险问卷'}</button></section>}
    <section className="risk-entry-section" aria-labelledby="risk-entry-heading">
      <div className="risk-deck">
        <span className="risk-deck-layer" aria-hidden="true" /><span className="risk-deck-layer" aria-hidden="true" /><span className="risk-deck-layer" aria-hidden="true" /><span className="risk-deck-layer" aria-hidden="true" />
        <button type="button" className="risk-entry-card" aria-label={risk ? '重新进行风险评估' : '开始风险评估'} onClick={() => setShowQuiz(true)}>
          <span className="risk-entry-edition">小苔 · INVESTOR PROFILE</span>
          <img src="/assets/risk-journal-v1.webp" alt="" width="210" height="155" />
          <span className="risk-entry-title" id="risk-entry-heading">认识自己，<br />再做选择。</span>
          <span className="risk-entry-bottom"><span><strong>{questionnaire.questions.length} 题 · 4 个维度</strong><small>{answers.some(value => value !== null) ? '继续未完成的评估' : risk ? '重新评估你的风险边界' : '开始风险承受能力评估'}</small></span><span className="risk-entry-arrow"><ArrowUpRight size={24} /></span></span>
        </button>
      </div>
      <div className="risk-entry-copy"><span className="risk-entry-kicker"><ShieldCheck size={14} /> 风险承受能力评估</span>
        <h2>先了解你的<br />投资边界。</h2><p>从过往经历到理财知识，从资金用途到波动承受。用一份更完整的问卷，记录真实的自己。</p>
        {risk ? <div className="risk-result-summary" role="status"><span>当前项目演示档位</span><strong>R{risk.level}<small>{risk.score} / {risk.maxScore ?? 20} 分</small></strong><p>评估日期 {dateText(risk.assessedAt)}{risk.knowledgeTotal !== undefined ? ` · 知识题 ${risk.knowledgeCorrect}/${risk.knowledgeTotal}` : ''}</p>{!currentRisk && <p role="alert">这是旧版评估记录，分值沿用原量表；请完成新版12题评估后再模拟申购。</p>}{risk.summary?.map(text => <p key={text}>{text}</p>)}</div> : <div className="risk-result-summary"><span>当前状态</span><strong className="risk-not-assessed">尚未评估</strong><p>点击叠层卡片进入问卷。</p></div>}
        <small className="risk-entry-note">项目演示问卷，仅用于独立沙箱的模拟拦截，不替代正式适当性评估。</small>
      </div>
    </section>
    <section className="panel">
      <div className="section-head"><div><h2>公募基金产品目录</h2><p>展示基金公司公开资料；基金资料与交易执行分开，当前只提供独立沙箱模拟。</p></div></div>
      <div className="product-grid">{state.products.map(product => {
        const held = holdings.get(product.id) ?? 0;
        const allowed = Boolean(risk && currentRisk && risk.level >= product.riskLevel);
        const draft = drafts[product.id] ?? { amount: '', shares: '' };
        const note = notes[product.id];
        const sendingKind = sending?.id === product.id ? sending.kind : null;
        const cardsForProduct = debitCards;
        const info = FUND_INFO[product.id] ?? { category: '公募基金', warning: '基金净值会波动，本金可能损失，过往业绩不代表未来表现。' };
        const cardId = cards[product.id] ?? cardsForProduct[0]?.id ?? '';
        return <article className="product-card" key={product.id}>
          <div className="section-head"><div><h3>{product.name}</h3><span className="status">项目演示档位 R{product.riskLevel}</span></div></div>
          <p>{info.category} · 基金代码 {product.code ?? '—'}</p>
          <p>基金管理人：{product.manager ?? '以基金公司公开资料为准'}</p>
          <a href={product.officialUrl ?? '#'} target="_blank" rel="noreferrer" className="fund-source-link">查看基金公司官方资料 ↗</a>
          <p className="status">{held > 0 ? `沙箱模拟持仓 ${sharesText(held)} 份 · 演示估值 ${money(Math.round(held * product.unitPriceCents))}` : '暂无沙箱模拟持仓'}</p>
          {!allowed && <p className="status">{risk && !currentRisk ? '旧版评估不能用于本次申购，请先完成新版12题问卷。' : risk ? `当前演示档位 R${risk.level}，低于本项目的演示门槛 R${product.riskLevel}。` : '申购前请先完成问卷；问卷结果仅用于项目内的模拟拦截。'}</p>}
          <div className="form-grid">
            <div className="field"><label htmlFor={`buy-${product.id}`}>模拟申购金额（元）</label><input id={`buy-${product.id}`} inputMode="decimal" autoComplete="off" placeholder="请输入金额" value={draft.amount} disabled={!allowed || sendingKind !== null || busy} onChange={event => setDraft(product.id, { amount: event.target.value })} /></div>
            <label className="field" htmlFor={`card-${product.id}`}>申购扣款借记卡<select id={`card-${product.id}`} value={cardId} disabled={!allowed || cardsForProduct.length === 0 || sendingKind !== null || busy} onChange={event => setCards(prev => ({ ...prev, [product.id]: event.target.value }))}>{cardsForProduct.length === 0 ? <option value="">没有可用借记卡</option> : cardsForProduct.map(card => <option key={card.id} value={card.id}>{card.name} · 尾号 {card.last4}</option>)}</select></label>
          </div>
          <label className="wealth-risk-check"><input type="checkbox" checked={Boolean(acknowledged[product.id])} disabled={!allowed || sendingKind !== null || busy} onChange={event => setAcknowledged(prev => ({ ...prev, [product.id]: event.target.checked }))} /><span>我已阅读：{info.warning}页面展示的是基金公开信息，本按钮只生成沙箱方案，不代表真实申购。</span></label>
          <button type="button" className="button btn-primary" disabled={!allowed || !acknowledged[product.id] || !cardId || sendingKind !== null || busy} onClick={() => void trade(product, 'buy')}>{sendingKind === 'buy' ? '生成方案中…' : '阅读告知并生成申购方案'}</button>
          <div className="form-grid"><div className="field"><label htmlFor={`sell-${product.id}`}>模拟赎回份额</label><input id={`sell-${product.id}`} inputMode="numeric" autoComplete="off" placeholder="整数份额" value={draft.shares} disabled={held <= 0 || sendingKind !== null || busy} onChange={event => setDraft(product.id, { shares: event.target.value })} /></div><button type="button" className="button btn-secondary" disabled={held <= 0 || sendingKind !== null || busy} onClick={() => void trade(product, 'sell')}>{sendingKind === 'sell' ? '发送中…' : '生成赎回方案'}</button></div>
          {note && <p className="status" role={note.tone === 'error' ? 'alert' : 'status'}>{note.text}</p>}
        </article>;
      })}</div>
      <div className="wealth-sandbox-note" role="note"><strong>交易模式：独立模拟银行沙箱</strong><p>基金名称、代码和管理人来自基金公司公开产品资料。份额价格固定为演示值 ¥1.00，风险档位由本项目演示设定；未接基金行情、销售机构、真实银行卡或支付接口。不会产生真实订单或资金变动。</p></div>
    </section>
  </>;
}
