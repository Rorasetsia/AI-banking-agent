import {useState} from 'react';
import {Check,ChevronDown,ChevronRight,Circle,Target} from 'lucide-react';
import type {AgentView} from '../agent-types';
import type {Plan,Route} from '../types';
import {money} from '../api';
import './AgentTaskCard.css';
import './AgentResult.css';
import {AgentQuestions} from './AgentQuestions';
import {SavingsPlanBody} from './SavingsPlanBody';
import {AgentFollowup} from './AgentFollowup';

const stages={clarifying:'补充条件',ready:'方案已算好',saved:'目标已保存',cancelled:'已结束',awaiting_confirmation:'等待你确认',completed:'信息已核对'};
export function AgentTaskCard({view,answer,plan,onOpenPlan,busy,onSend,onNavigate,isCurrent=true}:{
 view:AgentView;answer?:string;plan?:Plan;onOpenPlan?:(plan:Plan)=>void;busy:boolean;onSend:(text:string)=>Promise<boolean>;onNavigate?:(route:Route)=>void;isCurrent?:boolean;
}){
 const [historyOpen,setHistoryOpen]=useState(false);
 const savings=view.savings,facts=view.facts;
 const planStage=plan?({pending:'尚未执行 · 待确认',executed:'已执行',cancelled:'已取消',expired:'已过期',failed:'执行失败'} as Record<string,string>)[plan.status]:null;
 const planAction=plan&&onOpenPlan?<button type='button' className='agent-plan-primary' data-action='view-plan' disabled={busy} onClick={()=>onOpenPlan(plan)}><span>{plan.status==='pending'?'查看并确认方案':plan.status==='executed'?'查看办理结果':'查看方案状态'}</span><ChevronRight size={16}/></button>:null;
 if(!isCurrent&&!historyOpen)return <section className={`agent-task agent-task--history ${plan?'agent-task--linked-plan':''}`}>
  <button type='button' className='agent-task-expand' onClick={()=>setHistoryOpen(true)}>{plan?.title??view.title} · {planStage??'查看历史快照'}<ChevronDown size={12}/></button>{planAction}
 </section>;
 const actions=view.actions.filter(item=>(!savings||['save','cancel'].includes(item.id))&&!(item.id==='save'&&savings?.guidance?.lastResort?.actionIds.includes('save'))&&!(savings&&view.stage==='clarifying'&&item.id==='save')&&!(view.clarifications?.length&&['total','additional','ledger','this-month','next-month'].includes(item.id)));
 return <section className={`agent-task ${view.kind==='banking'?'agent-task--banking':''}`} aria-label={`${view.title}任务卡片`}>
  <header className='agent-task-head'><span className='agent-task-symbol'><Target size={17}/></span><strong>{view.title}</strong><span className={`agent-task-stage agent-task-stage--${view.stage}`}>{planStage??(savings?.feasible===false&&view.stage==='ready'?'需要调整':stages[view.stage])}</span></header>
  {view.steps.length>0&&<ol className='agent-task-steps' aria-label='任务步骤'>{view.steps.map((step,index)=><li key={`${step.label}-${index}`} data-status={step.status} aria-current={step.status==='current'?'step':undefined}>{step.status==='done'?<Check size={12}/>:<Circle size={10}/>}<span>{step.label}</span></li>)}</ol>}
  {view.kind==='banking'&&<div className='agent-result-body'>
   {view.highlights&&view.highlights.length>0&&<dl className='agent-result-highlights'>{view.highlights.map((fact,index)=><div key={index}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>}
   <p className='agent-result-answer'>{answer||view.summary}</p>
   {plan&&<section className='agent-plan-preview' aria-label='本次办理内容'><div><strong>{plan.impactCents!==0?`预计资金变化 ${money(plan.impactCents)}`:'本次不直接转出资金'}</strong><span>{plan.status==='pending'?'打开方案后再核对并授权；这里还没有执行。':'以当前方案状态和办理结果为准。'}</span></div><ul>{plan.steps.slice(0,3).map((step,index)=><li key={index}>{step.label}</li>)}</ul>{plan.steps.length>3&&<p>另有 {plan.steps.length-3} 项操作，请打开完整方案逐项核对。</p>}</section>}
   {planAction}
  </div>}
  {savings&&<SavingsPlanBody view={view} busy={busy} isCurrent={isCurrent} onSend={onSend} onNavigate={onNavigate}/>}
  {view.clarifications&&view.clarifications.length>0&&<AgentQuestions questions={view.clarifications} disabled={busy||!isCurrent} onSend={onSend}/>}
  {actions.length>0&&<div className='agent-task-actions'>{actions.map(item=><button key={item.id} data-action={item.id} type='button' disabled={busy||(item.kind==='send'&&!isCurrent)||(item.kind==='navigate'&&!onNavigate)} onClick={()=>{if(item.kind==='send'&&item.text&&isCurrent)void onSend(item.text);else if(item.kind==='navigate'&&item.route)onNavigate?.(item.route);}}>{plan&&item.route==='tasks'?'其他任务与凭证':item.label}</button>)}</div>}
  {facts.length>0&&<details className='agent-known-facts'><summary><span>依据与条件 · {facts.length} 项</span><span className='agent-facts-toggle'><span className='agent-facts-show'>查看</span><span className='agent-facts-hide'>收起</span><ChevronDown size={12}/></span></summary><dl className='agent-task-facts'>{facts.map((fact,index)=><div key={`${fact.label}-${index}`}><dt>{fact.label}</dt><dd>{fact.value}<small>{fact.source}</small></dd></div>)}</dl></details>}
  {!isCurrent&&<p className='agent-task-history'>这是历史对话，办理请以方案当前状态为准。</p>}
  {isCurrent&&!view.clarifications?.length&&<AgentFollowup busy={busy} onSend={onSend} label={savings?'用自己的话修改或补充安排':'补充需求或修改安排'}/>}
  {savings&&view.stage!=='saved'&&<p className='agent-task-note'>保存只记录目标和预算；结束修改只停止这轮追问。两者都不会扣款，也不会取消已保存目标。</p>}
  {view.stage==='saved'&&<p className='agent-task-note'>仅保存目标，没有预留资金、申购理财或授权扣款。</p>}
 </section>;
}
