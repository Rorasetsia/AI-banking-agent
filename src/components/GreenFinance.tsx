import {useRef} from 'react';
import {ArrowDown,ChevronDown,Leaf} from 'lucide-react';
import type {PageProps} from '../types';
import {GreenChoices} from './GreenChoices';
import {GreenWeeklyGoal} from './GreenWeeklyGoal';
import {GreenInsights} from './GreenInsights';
import './GreenFinance.css';
export function GreenFinance(props:PageProps){
  const goalRef=useRef<HTMLDivElement>(null);
  function focusGoal(){goalRef.current?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});goalRef.current?.focus({preventScroll:true});}
  return <div className="gs-page">
    <header className="gs-hero"><div><p className="gs-eyebrow"><Leaf size={14}/> 绿色生活 · 量力而行</p><h1>算一算绿色成本，<wbr/>试一试环保生活</h1><p>在预算与时间内选出更环保的方案，完成小目标还能收获看得见的鼓励。</p></div><button type="button" className="gs-hero-goal" onClick={focusGoal}>我的7天小目标 <ArrowDown size={16}/></button></header>
    <div className="gs-layout"><GreenChoices key={props.state.userId} draftKey={`green.choices.${props.state.userId}`} send={props.send} busy={props.busy} onGoal={focusGoal}/><div ref={goalRef} tabIndex={-1} className="gs-goal-wrap"><GreenWeeklyGoal state={props.state}/></div></div>
    <details className="gs-insights"><summary><span><Leaf size={18}/><span><strong>消费表现与依据</strong><small>自愿开启交通支付分析 · 分类可纠正</small></span></span><ChevronDown size={20}/></summary><GreenInsights {...props}/></details>
    <p className="gs-footnote">独立银行模拟环境 · 费用为输入情景估算，行动记录不代表碳认证或真实公益捐赠。</p>
  </div>;
}
