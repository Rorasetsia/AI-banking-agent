import {useState} from 'react';
import {ChevronDown,ChevronRight,ExternalLink} from 'lucide-react';
import {money} from '../api';
import type {AgentView} from '../agent-types';
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
 const corrections=view.actions.filter(a=>['adjust-target','extend'].includes(a.id));
 let remaining=s.gapCents,cumulative=s.mode==='additional'?0:s.usableStartingCents;
 const table=s.budgetSchedule??s.schedule.map(row=>{const amountCents=Math.min(remaining,planned);remaining-=amountCents;cumulative+=amountCents;return{month:row.month,amountCents,cumulativeCents:cumulative};});
 const eligible=s.products.filter(p=>p.eligible);
 return <div className='savings-plan-body'>
  <section className={`savings-verdict ${s.feasible===false?'savings-verdict--shortfall':''}`} aria-label='目标可行性结论'>
   <span className='savings-eyebrow'>{s.feasible===false?'先看目标差距':'按当前收支安排'}</span>
   <h3>{s.feasible===false?<>到期还差 <strong>{money(missing)}</strong></>:s.feasible===true?'按这份预算可以安排完成':'先核对每月收支，再决定存多少'}</h3>
   <p>{incomeCents!=null&&expenseCents!=null?`月收入${money(incomeCents)} − 必要支出${money(expenseCents)} = 每月结余${money(s.monthlyCapacityCents??0)}。`:''}{s.feasible===false?'现有结余支撑不了原目标，先改目标或期限更合适。':'这里只做规划，不会自动扣款。'}</p>
   <div className='savings-budget-metrics'><div><span>按预算每月安排</span><strong>{money(planned)}</strong></div><div><span>{s.months}个月预计{s.mode==='additional'?'新增':'累计'}</span><strong>{money(atDeadline)}</strong></div></div>
   <p className='savings-required'>原目标 {money(s.targetCents)} · 截止 {s.deadline}<br/>如保持原目标和期限，每月需存 {money(s.monthlyRequiredCents)}{s.feasible===false?'，超过当前结余；这不是本次建议存入额。':'。'}</p>
  </section>
  {isCurrent&&view.stage!=='clarifying'&&<section className='savings-next-step' aria-label='调整存钱方案'>
   <h4>{s.feasible===false?'接下来，你想怎么调整？':'想再改一改？'}</h4>
   {corrections.length>0&&<div className='savings-choices'>{corrections.map(action=><button type='button' key={action.id} data-action={action.id} disabled={locked} onClick={()=>action.text&&void onSend(action.text)}><span><small>{action.id==='adjust-target'?'保留现在的期限':'保留现在的目标'}</small><strong>{action.label}</strong></span><ChevronRight size={16}/></button>)}</div>}
   <button type='button' className='savings-edit-toggle' aria-expanded={editing} disabled={locked} onClick={()=>setEditing(!editing)}>{editing?'收起自定义条件':'自己设置目标、期限和收支'}<ChevronDown size={13}/></button>
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
  {s.products.length>0&&<section className='savings-investment' aria-label='理财与目标测算'>
   <h4>理财能帮多少？</h4>
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
  </section>}
  <details className='agent-task-detail'><summary>账单与资金工具<ChevronDown size={13}/></summary><div className='savings-support-actions'>{view.actions.filter(a=>['bills','reserve'].includes(a.id)).map(a=><button type='button' disabled={locked} key={a.id} onClick={()=>a.kind==='navigate'&&a.route?onNavigate?.(a.route):a.text&&void onSend(a.text)}>{a.label}</button>)}</div><p>资金预留如需办理，会另行生成待确认方案。</p></details>
  <details className='agent-task-detail'><summary>计算假设与风险说明<ChevronDown size={13}/></summary><ul>{[...s.assumptions,...s.warnings].map((note,i)=><li key={i}>{note}</li>)}</ul></details>
 </div>;
}
