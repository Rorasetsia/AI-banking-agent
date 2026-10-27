import {useState} from 'react';
import {ChevronDown,ChevronRight,ExternalLink} from 'lucide-react';
import {money} from '../api';
import type {AgentView,SavingsGuidanceOption} from '../agent-types';
import type {Route} from '../types';
import {DateTimePicker} from './DateTimePicker';
import './SavingsPlanBody.css';

function trustedLink(value?:string){try{const u=new URL(value??'');return u.protocol==='https:'&&(u.hostname==='efunds.com.cn'||u.hostname.endsWith('.efunds.com.cn'))?u.href:null}catch{return null}}
export function SavingsPlanBody({view,busy,isCurrent,onSend,onNavigate}:{view:AgentView;busy:boolean;isCurrent:boolean;onSend:(text:string)=>Promise<boolean>;onNavigate?:(route:Route)=>void}){
 const s=view.savings!;const locked=busy||!isCurrent;
 const knownMoney=(label:string)=>{const raw=view.facts.find(f=>f.label===label)?.value??'';if(!/^[¥￥][\d,]+(?:\.\d{1,2})?$/.test(raw))return null;const cents=Math.round(Number(raw.slice(1).replace(/,/g,''))*100);return Number.isSafeInteger(cents)?cents:null;};
 const incomeCents=s.monthlyIncomeCents??knownMoney('月收入'),expenseCents=s.monthlyExpenseCents??knownMoney('月必要支出');
 const [editing,setEditing]=useState(false);
 const [target,setTarget]=useState(String(s.targetCents/100));const [deadline,setDeadline]=useState(s.deadline);
 const [income,setIncome]=useState(incomeCents==null?'':String(incomeCents/100));const [expense,setExpense]=useState(expenseCents==null?'':String(expenseCents/100));
 const [rate,setRate]=useState(String((s.simulation?.annualRateBps??0)/100));
 const validMoney=(v:string,positive=false)=>/^\d+(\.\d{1,2})?$/.test(v)&&Number(v)>=(positive ? 0.01 : 0)&&Number(v)<=1e9;
 const validEdit=validMoney(target,true)&&Boolean(deadline)&&validMoney(income)&&validMoney(expense);
 const validRate=/^-?\d+(\.\d{1,2})?$/.test(rate)&&Number(rate)>=-20&&Number(rate)<=20;
 const planned=s.monthlyPlannedCents??Math.min(s.monthlyRequiredCents,Math.max(0,s.monthlyCapacityCents??0));
 const atDeadline=s.atDeadlineCents??(s.mode==='additional'?0:s.usableStartingCents)+planned*s.months;
 const missing=s.shortfallAtDeadlineCents??Math.max(0,s.targetCents-atDeadline);
 const guidance=s.guidance;
 const actionFor=(id?:string)=>view.actions.find(a=>a.id===id);
 const act=(id?:string)=>{if(locked||view.stage==='clarifying')return;const a=actionFor(id);if(a?.kind==='navigate'&&a.route)onNavigate?.(a.route);else if(a?.text)void onSend(a.text);};
 const optionButton=(option:SavingsGuidanceOption,primary=false)=>{const a=actionFor(option.actionId);if(option.kind==='edit'||option.actionId==='save')return null;return <button className={primary?'savings-adopt':'savings-alternative-action'} type='button' data-action={option.actionId} disabled={locked||view.stage==='clarifying'||!a||(a.kind==='navigate'&&!onNavigate)} onClick={()=>act(option.actionId)}>{a?.kind==='navigate'?a.label:primary?'采用建议，重新计算':'按这个备选重新计算'}<ChevronRight size={14}/></button>;};
 const corrections=view.actions.filter(a=>['adjust-target','extend'].includes(a.id));
 let remaining=s.gapCents,cumulative=s.mode==='additional'?0:s.usableStartingCents;
 const table=s.budgetSchedule??s.schedule.map(row=>{const amountCents=Math.min(remaining,planned);remaining-=amountCents;cumulative+=amountCents;return{month:row.month,amountCents,cumulativeCents:cumulative};});
 const eligible=s.products.filter(p=>p.eligible);
 return <div className='savings-plan-body'>
  <section className={`savings-verdict ${s.feasible===false?'savings-verdict--shortfall':''}`} aria-label='当前储蓄情况'>
   <span className='savings-section-label'><b>01</b> 先看你现在的情况</span>
   <h3>{guidance?.headline??(s.feasible===false?'原目标暂时超出当前预算':s.feasible===true?'按当前收支可以安排目标':'先核对每月收支')}</h3>
   <p className='savings-goal-line'>希望在 {s.deadline} 前{s.mode==='additional'?'新增攒下':'累计达到'} <strong>{money(s.targetCents)}</strong></p>
   <div className='savings-cashflow' aria-label='收入与可存资金'><div><span>月收入</span><strong>{incomeCents==null?'待核对':money(incomeCents)}</strong></div><i>−</i><div><span>必要支出</span><strong>{expenseCents==null?'待核对':money(expenseCents)}</strong></div><i>=</i><div><span>已知月结余</span><strong>{s.monthlyCapacityCents==null?'待核对':money(s.monthlyCapacityCents)}</strong></div></div>
   <div className='savings-budget-metrics'><div><span>当前预算内每月安排</span><strong>{s.monthlyCapacityCents==null?'待核对':money(planned)}</strong></div><div><span>原期限预计{s.mode==='additional'?'新增':'累计'}</span><strong>{s.monthlyCapacityCents==null&&s.gapCents>0?'待核对':money(atDeadline)}</strong></div></div>
   {s.feasible===false&&<p className='savings-shortfall'>距原目标还差 <strong>{money(missing)}</strong>，当前条件下无法按期完成。</p>}
   {guidance&&guidance.status!=='shortfall'&&<p className='savings-situation-note'>{guidance.explanation}</p>}
   <details className='savings-required-detail'><summary>查看达标要求与计算口径<ChevronDown size={12}/></summary><p>保持原目标与期限，每月需要 {money(s.monthlyRequiredCents)}。{s.feasible===false?'这个金额超过当前结余，只是达标要求，并非建议存入金额。':'以上是预算测算，仍需核对浮动开销。'}基础计划不计投资收益，也不会自动扣款。</p></details>
  </section>
  {guidance?.preferred&&<section className='savings-decision' aria-label='优选方案' data-guidance='preferred'>
   <span className='savings-section-label'><b>02</b> 我优先建议这样安排</span>
   <h4>{guidance.preferred.title}</h4><p>{guidance.preferred.reason}</p>
   <p className='savings-tradeoff'><strong>需要考虑</strong>{guidance.preferred.tradeoff}</p>
   {optionButton(guidance.preferred,true)}
   {guidance.preferred.actionId==='save'&&<p className='savings-save-hint'>{view.stage==='saved'?'这份目标已保存，实际存入仍由你安排。':'核对后，可在卡片底部保存这份安排。'}</p>}
  </section>}
  {guidance&&guidance.alternatives.some(o=>o.kind!=='edit')&&<section className='savings-alternatives' aria-label='备选方案'><h4>备选方案 · 如果优选不适合你</h4>{guidance.alternatives.filter(o=>o.kind!=='edit').map(option=><article key={option.id}><h5>{option.title}</h5><p>{option.reason}</p><p className='savings-tradeoff'>{option.tradeoff}</p>{optionButton(option)}</article>)}</section>}
  {guidance?.lastResort&&<section className='savings-unresolved' aria-label='暂时无法达成时的安排'><span className='savings-section-label'><b>03</b> 如果暂时还解决不了</span><h4>{guidance.lastResort.title}</h4><p>{guidance.lastResort.body}</p>{guidance.lastResort.actionIds.map(id=>{const a=actionFor(id);return a&&<button type='button' key={id} data-action={id} disabled={locked||view.stage==='clarifying'||(a.kind==='navigate'&&!onNavigate)} onClick={()=>act(id)}>{id==='save'&&view.stage!=='saved'?'先保留原目标，稍后继续':a.label}<ChevronRight size={13}/></button>;})}</section>}
  {isCurrent&&view.stage!=='clarifying'&&<section className='savings-next-step' aria-label='自定义存钱安排'>
   {!guidance&&corrections.length>0&&<div className='savings-choices'>{corrections.map(action=><button type='button' key={action.id} data-action={action.id} disabled={locked} onClick={()=>act(action.id)}><strong>{action.label}</strong><ChevronRight size={16}/></button>)}</div>}
   <button type='button' className='savings-edit-toggle' aria-expanded={editing} disabled={locked} onClick={()=>setEditing(!editing)}>{editing?'收起自定义条件':'我想自己修改条件'}<ChevronDown size={13}/></button>
   {editing&&<form className='savings-edit-form' onSubmit={async e=>{e.preventDefault();if(validEdit&&!locked)await onSend(`储蓄目标${target}元，完成期限为${deadline}，月收入${income}元，每月支出${expense}元`);}}>
    <label>目标金额（元）<input aria-label='调整目标金额' inputMode='decimal' value={target} onChange={e=>setTarget(e.target.value)} disabled={locked}/></label>
    <label>完成期限<DateTimePicker type='date' aria-label='调整完成期限' value={deadline} onChange={setDeadline} disabled={locked}/></label>
    <label>每月收入（元）<input aria-label='调整每月收入' inputMode='decimal' value={income} onChange={e=>setIncome(e.target.value)} disabled={locked}/></label>
    <label>每月必要支出（元）<input aria-label='调整每月必要支出' inputMode='decimal' value={expense} onChange={e=>setExpense(e.target.value)} disabled={locked}/></label>
    <button type='submit' disabled={locked||!validEdit}>按这些条件重新计算</button>
   </form>}
  </section>}
  <details className='agent-task-detail'><summary>查看按预算安排的月度存入<ChevronDown size={13}/></summary><div className='agent-task-table-wrap' tabIndex={0} aria-label='按预算月度存钱安排'>
   <table><thead><tr><th>月份</th><th>预算内存入</th><th>{s.mode==='additional'?'累计新增':'预计累计'}</th></tr></thead><tbody>{table.map(row=><tr key={row.month}><td>{row.month}</td><td>{money(row.amountCents)}</td><td>{money(row.cumulativeCents)}</td></tr>)}</tbody></table>
  </div><p>按月末存入、不计投资收益的预算安排，未设置自动扣款。</p></details>
  {s.products.length>0&&<details className='savings-investment' aria-label='理财与目标测算' open={Boolean(s.simulation&&s.simulation.annualRateBps!==0)}><summary>补充参考 · 理财能帮多少？<ChevronDown size={13}/></summary><p className='savings-small'>先安排预算内存钱，再比较理财。收益假设不计入基础达标判断。</p>
   {s.riskStatus!=='current'?<><p>{s.riskStatus===undefined?'先更新这份旧方案，核对当前评估和产品匹配。':s.riskStatus==='expired'?'上次评估已过期，先重新确认风险承受能力。':'先完成风险问卷，再按你的风险档位和目标期限比较目录中的产品。'}</p><button type='button' disabled={locked||(s.riskStatus!==undefined&&!onNavigate)} onClick={()=>s.riskStatus===undefined?void onSend('继续这份储蓄计划，结合风险评估比较理财'):onNavigate?.('wealth')}>{s.riskStatus===undefined?'更新这份目标的理财匹配':'去完成风险评估，再回到这个目标'}<ChevronRight size={14}/></button><p className='savings-small'>已有问卷会重新核对有效性，目标仍会保留。基金不是存款，收益也不能预先保证。</p></>:
   <><p>当前演示风险档位 R{s.riskLevel} · {eligible.length} 个候选可继续比较。是否购买仍需核对流动性、费用和风险。</p>
    {eligible.length>0?<>
     <ul className='savings-product-candidates'>{eligible.map(p=>{const link=trustedLink(p.officialUrl);return <li key={p.id}><strong>{p.name}</strong><span>基金代码 {p.code} · 演示 R{p.riskLevel}</span><p>{p.reason}</p>{link&&<a href={link} target='_blank' rel='noopener noreferrer'>基金公司资料<ExternalLink size={11}/></a>}</li>})}</ul>
     {s.simulation&&<><form className='savings-rate-form' onSubmit={async e=>{e.preventDefault();if(validRate&&!locked)await onSend(`按假设年化${rate}%测算这份储蓄计划`);}}><label>自填年化情景（%）<input aria-label='假设年化收益率' inputMode='decimal' value={rate} onChange={e=>setRate(e.target.value)} disabled={locked}/></label><button type='submit' disabled={locked||!validRate}>计算这个假设</button></form>
      <p className='savings-small'>默认0%；可填-20%至20%。这是你自定的假设，不是任何产品的收益率。</p>
      <div className='savings-scenario-result' aria-label='收益情景测算结果'><div><span>投入本金合计</span><strong>{money(s.simulation.contributionCents)}</strong></div><div><span>{s.simulation.annualRateBps/100}%假设下的收益</span><strong>{money(s.simulation.estimatedReturnCents)}</strong></div><div><span>假设到期合计</span><strong>{money(s.simulation.projectedTotalCents)}</strong></div></div>
      <p className='savings-scenario-verdict'>{s.simulation.targetReached?'在这个假设下测算可达，实际结果仍会变化。':`在这个假设下仍差${money(s.simulation.shortfallCents)}，不能把这部分收益当作已完成的储蓄。`}</p>
      <details><summary>查看测算方法与边界</summary><ul>{s.simulation.assumptions.map(note=><li key={note}>{note}</li>)}</ul></details>
     </>}
    </>:<p>当前目录没有同时符合风险档位和期限的候选。先按不计收益的存钱安排推进。</p>}
    <button type='button' disabled={locked||!onNavigate} onClick={()=>onNavigate?.('wealth')}>查看产品、费用与模拟申购条件<ChevronRight size={14}/></button>
   </>}
  </details>}
  <details className='agent-task-detail'><summary>账单与资金工具<ChevronDown size={13}/></summary><div className='savings-support-actions'>{view.actions.filter(a=>['bills','reserve'].includes(a.id)).map(a=><button type='button' disabled={locked} key={a.id} onClick={()=>a.kind==='navigate'&&a.route?onNavigate?.(a.route):a.text&&void onSend(a.text)}>{a.label}</button>)}</div><p>资金预留如需办理，会另行生成待确认方案。</p></details>
  <details className='agent-task-detail'><summary>计算假设与风险说明<ChevronDown size={13}/></summary><ul>{[...s.assumptions,...s.warnings].map((note,i)=><li key={i}>{note}</li>)}</ul></details>
 </div>;
}
