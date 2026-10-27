import {useCallback,useEffect,useRef,useState} from 'react';
import {Check,ChevronDown,Flag,Footprints,TrainFront,Zap} from 'lucide-react';
import {request} from '../api';
import type {PageProps} from '../types';
import {GreenFirework} from './GreenFirework';
import {FeatureEntry} from './FeatureEntry';

type GoalType='public_transport'|'walk_cycle'|'energy_saving';
interface GoalDay {date:string;isToday:boolean;future:boolean;done:boolean;manual:boolean;transactionIds:string[]}
interface Goal {id:string;type:GoalType;title:string;startDate:string;endDate:string;targetDays:number;useBankRecords:boolean;bankLinked:boolean;completedDays:number;status:string;days:GoalDay[];feedback:string;updatedAt:string;manualDays:number;bankDays:number}
interface Goals {today:string;asOf:string;consent:boolean;current:Goal|null;history:Goal[]}
const choices=[
  {type:'public_transport' as const,title:'公共交通',description:'有合适的行程时，试一次公交或地铁。',Icon:TrainFront},
  {type:'walk_cycle' as const,title:'步行或骑行',description:'选一段安全、方便的短途步行或骑行。',Icon:Footprints},
  {type:'energy_saving' as const,title:'随手节能',description:'关掉一处闲置照明或不用的电器。',Icon:Zap},
];
const short=(date:string)=>date.slice(5).replace('-','/');
export function GreenWeeklyGoal({state}:Pick<PageProps,'state'>){
  const [data,setData]=useState<Goals|null>(null),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const [type,setType]=useState<GoalType>('public_transport'),[target,setTarget]=useState(3),[link,setLink]=useState(false),[editing,setEditing]=useState(false),[confirmEnd,setConfirmEnd]=useState(false);
  const seq=useRef(0),alive=useRef(true),busy=useRef(false);
  const currentData=useRef<Goals|null>(null);
  const [celebration,setCelebration]=useState<{date:string;token:number}|null>(null);
  useEffect(()=>{if(!celebration)return;const timer=window.setTimeout(()=>setCelebration(null),1500);return()=>window.clearTimeout(timer);},[celebration]);
  const acceptResult=useCallback((result:Goals)=>{
    const previous=currentData.current?.current;
    const next=result.current;
    if(previous&&next&&previous.id===next.id){
      const newlyDone=next.days.find(d=>d.done&&!previous.days.some(old=>old.date===d.date&&old.done));
      if(newlyDone)setCelebration(old=>({date:newlyDone.date,token:(old?.token??0)+1}));
      else if(next.completedDays<previous.completedDays)setCelebration(null);
    }
    currentData.current=result;setData(result);
  },[]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;seq.current++;};},[]);
  const load=useCallback(async()=>{
    const ticket=++seq.current;setError('');
    try{const result=await request<Goals>('/green/goals');if(alive.current&&ticket===seq.current)acceptResult(result);}
    catch(e){if(alive.current&&ticket===seq.current)setError(e instanceof Error?e.message:'目标加载失败，请重试。');}
  },[acceptResult]);
  useEffect(()=>{currentData.current=null;setCelebration(null);},[state.userId]);
  useEffect(()=>{setData(null);setEditing(false);setConfirmEnd(false);void load();},[load,state.userId,state.now,state.green?.consent]);
  async function mutate(path:string,body:unknown){
    if(busy.current)return;busy.current=true;setSaving(true);setError('');const ticket=++seq.current;
    try{const result=await request<Goals>(path,body);if(alive.current&&ticket===seq.current){acceptResult(result);setEditing(false);setConfirmEnd(false);}}
    catch(e){if(alive.current&&ticket===seq.current)setError(e instanceof Error?e.message:'未保存成功，请重试。');}
    finally{busy.current=false;if(alive.current)setSaving(false);}
  }
  const goal=data?.current;
  const isClosed=goal?.status==='cancelled'||goal?.status==='ended';
  const createForm=(!goal||editing)&&data;
  return <section className="gw-panel" id="green-week-goal" aria-labelledby="gw-title">
    <div className="gw-heading"><span className="gw-icon"><Flag size={19}/></span><div><p className="gs-eyebrow">让改变持续一点</p><h2 id="gw-title">一个7天小目标</h2></div></div>
    {data&&<p className="gw-clock">模拟环境今日 {short(data.today)} · 以此日期记录行动</p>}
    {error&&<div role="alert" className="gs-error">{error} {!data&&<button type="button" onClick={()=>void load()}>重新加载</button>}</div>}
    {!data&&!error&&<p role="status">正在读取目标…</p>}
    {goal&&!editing&&<>
      <div className="gw-goal-line"><strong>{goal.title}</strong><span>{short(goal.startDate)} — {short(goal.endDate)}</span></div>
      <p className="gw-progress-number"><b>{goal.completedDays}</b><span>/ {goal.targetDays} 个记录日</span>{goal.status==='completed'&&<em><Check size={14}/>已达成</em>}</p>
      <div className="gw-progress-row"><div className="gw-progress-track"><div className="gw-progress" role="progressbar" aria-label="7天目标进度" aria-valuemin={0} aria-valuemax={goal.targetDays} aria-valuenow={Math.min(goal.completedDays,goal.targetDays)}><span style={{width:`${Math.min(100,goal.completedDays/goal.targetDays*100)}%`}}/></div>
      {celebration&&<div className="gw-firework-anchor" style={{left:`${Math.min(100,goal.completedDays/goal.targetDays*100)}%`}}><GreenFirework key={celebration.token} date={celebration.date} animate/></div>}</div></div>
      <p className="gw-feedback" aria-live="polite">{goal.feedback}</p>
      <div className="gw-days">{goal.days.map(d=><button key={d.date} type="button" disabled={saving||d.future||isClosed||(!d.manual&&d.transactionIds.length>0)} aria-label={`${d.date}${d.manual?'，已手动记录，点击撤销':d.transactionIds.length?'，有公共交通支付线索':d.future?'，尚未到来':'，点击记录行动'}`} aria-pressed={d.done} className={`${d.done?'done':''} ${d.isToday?'today':''}`} onClick={()=>void mutate('/green/goals/record',{goalId:goal.id,date:d.date,action:d.manual?'remove':'add'})}><span>{short(d.date)}</span><i>{d.done?<Check size={15}/>:d.isToday?'今':'·'}</i><small>{d.manual?'自记':d.transactionIds.length?'线索':d.future?'待到来':'可记录'}</small></button>)}</div>
      <p className="gw-caption">点击日期记录或撤销。每天最多计1天。</p>
      <div className="gw-source"><span>自行记录 {goal.manualDays} 天</span><span>支付线索 {goal.bankDays} 天</span><small>同日重合只计一次</small></div>
      <details className="gw-details"><summary>记录依据与目标设置 <ChevronDown size={14}/></summary>
        <p>自行记录由你确认；支付线索只代表本账户存在可识别公共交通支付，不代表核实了行程。不读取定位，不估算实际碳、水或电的节约量。</p>
        {goal.type==='public_transport'&&<p>{goal.bankLinked?'已关联授权账单；充值、退款及疑似重复支付不计。分类纠正后进度会重新核对。':'未关联账单，只计你手动记录的行动。'}</p>}
        <p>目标依据模拟环境日期 {short(data!.today)} 更新。最近设置或手动记录：{short(goal.updatedAt.slice(0,10))}。</p>
        <button type="button" className="gs-link" disabled={saving} onClick={()=>{setTarget(goal.targetDays);setType(goal.type);setLink(goal.bankLinked);setEditing(true);}}>调整目标</button>
        {!confirmEnd?<button type="button" className="gs-link gw-end" disabled={saving} onClick={()=>setConfirmEnd(true)}>结束本次目标</button>:<div className="gw-confirm"><p>保留记录，结束本次目标？</p><button type="button" disabled={saving} onClick={()=>void mutate('/green/goals/cancel',{goalId:goal.id})}>确认结束</button><button type="button" onClick={()=>setConfirmEnd(false)}>继续保留</button></div>}
      </details>
    </>}
    {createForm&&<FeatureEntry title={editing?'调整绿色行动目标':'设定绿色行动小目标'} description="选择一种行动，安排接下来7天。" revealKey={editing?1:0}><form className="gw-form" onSubmit={e=>{e.preventDefault();void mutate(editing?'/green/goals/update':'/green/goals',editing?{goalId:goal!.id,targetDays:target,useBankRecords:type==='public_transport'&&link}:{type,targetDays:target,useBankRecords:type==='public_transport'&&link});}}>
      {!editing&&<><p className="gw-intro">不必一步到位，选一件适合自己的小事。</p><div className="gw-choices">{choices.map(({type:t,title,Icon})=><button type="button" key={t} aria-pressed={type===t} onClick={()=>{setType(t);setLink(false);}}><Icon size={17}/>{title}</button>)}</div><p className="gw-action">{choices.find(c=>c.type===type)?.description}</p></>}
      <label className="gw-target">接下来7天，做到 <select value={target} disabled={saving} onChange={e=>setTarget(Number(e.target.value))} aria-label="目标行动天数">{[1,2,3,4,5,6,7].map(n=><option key={n} value={n}>{n}天</option>)}</select></label>
      {type==='public_transport'&&<details className="gw-details"><summary>可选：用账单线索辅助记录 <ChevronDown size={14}/></summary>{data.consent?<label className="gw-checkbox"><input type="checkbox" checked={link} disabled={saving} onChange={e=>setLink(e.target.checked)}/>关联公共交通支付线索（每天最多1天）</label>:<p>先在下方“消费表现与依据”自愿开启分析，再回到这里关联。</p>}<p>支付不等于核实乘车。充值、退款、疑似重复不计；撤回分析授权会关闭关联，不会自动恢复。</p></details>}
      <button type="submit" className="gs-primary" disabled={saving}>{saving?'正在保存…':editing?'保存调整':'建立7天目标'}</button>
      {editing&&<button type="button" className="gs-link" disabled={saving} onClick={()=>setEditing(false)}>返回目标</button>}
      {!editing&&<small className="gw-caption">只记录行动，不预留资金，也不产生扣款。</small>}
    </form></FeatureEntry>}
    {data&&data.history.length>0&&<details className="gw-details gw-history"><summary>过去的记录 <span>{data.history.length}</span></summary>{data.history.map(g=><div key={g.id}><strong>{g.title}</strong><span>{short(g.startDate)} · {g.completedDays}/{g.targetDays}天</span><p>{g.feedback}</p></div>)}</details>}
  </section>;
}
