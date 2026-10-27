import { useState } from 'react';
import { Check, ChevronDown, Circle, Target } from 'lucide-react';
import type { AgentView } from '../agent-types';
import type { Route } from '../types';
import './AgentTaskCard.css';
import { AgentQuestions } from './AgentQuestions';
import { SavingsPlanBody } from './SavingsPlanBody';
import { AgentFollowup } from './AgentFollowup';

const stages = { clarifying: '补充条件', ready: '方案已算好', saved: '目标已保存', cancelled: '已结束', awaiting_confirmation: '等待你确认', completed: '信息已核对' };
export function AgentTaskCard({ view, busy, onSend, onNavigate, isCurrent = true }: {
  view: AgentView; busy: boolean; onSend: (text: string) => Promise<boolean>; onNavigate?: (route: Route) => void; isCurrent?: boolean;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const savings = view.savings;
  const facts = view.facts;
  if(!isCurrent && !historyOpen)return <section className='agent-task agent-task--history'><button type='button' className='agent-task-expand' onClick={()=>setHistoryOpen(true)}>历史方案 · {view.title} · 查看快照 <ChevronDown size={12} /></button></section>;
  return <section className='agent-task' aria-label={`${view.title}任务卡片`}>
    <header className='agent-task-head'><span className='agent-task-symbol'><Target size={17} /></span><strong>{view.title}</strong><span className={`agent-task-stage agent-task-stage--${view.stage}`}>{savings?.feasible===false && view.stage==='ready'?'需要调整':stages[view.stage]}</span></header>
    {view.steps.length > 0 && <ol className='agent-task-steps' aria-label='任务步骤'>{view.steps.map((step, index) => <li key={`${step.label}-${index}`} data-status={step.status} aria-current={step.status === 'current' ? 'step' : undefined}>
      {step.status === 'done' ? <Check size={12} /> : <Circle size={10} />}<span>{step.label}</span>
    </li>)}</ol>}
    {savings && <SavingsPlanBody view={view} busy={busy} isCurrent={isCurrent} onSend={onSend} onNavigate={onNavigate} />}
    {view.clarifications && view.clarifications.length > 0 && <AgentQuestions questions={view.clarifications} disabled={busy || !isCurrent} onSend={onSend} />}
    {facts.length > 0 && <details className='agent-known-facts'><summary><span>已核对 {facts.length} 项条件<small>{facts.slice(0,2).map(fact => `${fact.label} ${fact.value}`).join(' · ')}</small></span><span className='agent-facts-toggle'><span className='agent-facts-show'>展开</span><span className='agent-facts-hide'>收起</span><ChevronDown size={13} /></span></summary><dl className='agent-task-facts'>{facts.map((fact, index) => <div key={`${fact.label}-${index}`}><dt>{fact.label}</dt><dd>{fact.value}<small>{fact.source}</small></dd></div>)}</dl></details>}
    {!isCurrent && <p className='agent-task-history'>历史方案快照。继续办理请以最新对话和任务状态为准。</p>}
    {isCurrent && !view.clarifications?.length && <AgentFollowup busy={busy} onSend={onSend} label={savings?'用自己的话修改或补充安排':'告诉小苔下一步想做什么'} />}
    <div className='agent-task-actions'>{view.actions.filter(item => (!savings || ['save','cancel'].includes(item.id)) && !(savings && view.stage==='clarifying' && item.id==='save') && !(view.clarifications?.length && ['total','additional','ledger','this-month','next-month'].includes(item.id))).map(item => <button key={item.id} data-action={item.id} type='button' disabled={busy || (item.kind === 'send' && !isCurrent) || (item.kind === 'navigate' && !onNavigate)} onClick={() => {
      if (item.kind === 'send' && item.text && isCurrent) onSend(item.text);
      else if (item.kind === 'navigate' && item.route) onNavigate?.(item.route);
    }}>{item.label}</button>)}</div>
    {savings && view.stage !== 'saved' && <p className='agent-task-note'>保存只记录目标和预算；结束修改只停止这轮追问。两者都不会扣款，也不会取消已保存目标。</p>}
    {view.stage === 'saved' && <p className='agent-task-note'>仅保存目标，没有预留资金、申购理财或授权扣款。</p>}
  </section>;
}
