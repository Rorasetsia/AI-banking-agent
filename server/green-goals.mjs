import {randomUUID} from 'node:crypto';
import {appendAudit} from './seed.mjs';
import {greenReport} from './green-analysis.mjs';

const DAY=86400000;
const TYPES={public_transport:'公共交通',walk_cycle:'步行或骑行',energy_saving:'随手节能'};
const fail=(message,code='INVALID_GREEN_GOAL',status=400)=>{throw Object.assign(new Error(message),{code,status});};
export const greenDay=value=>new Date(Date.parse(value)+8*3600000).toISOString().slice(0,10);
const shift=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);
const goals=state=>state.green?.weeklyGoals??[];
function validate(body,keys){
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!keys.includes(k)))fail('目标包含不支持的字段。');
}
function target(value){if(!Number.isInteger(value)||value<1||value>7)fail('请选择1—7个行动日。');}
function link(state,type,value){
  if(typeof value!=='boolean')fail('请明确是否关联账单线索。');
  if(value&&type!=='public_transport')fail('仅公共交通目标支持关联账单线索。');
  if(value&&state.green?.consent!==true)fail('请先自愿开启消费分析，再关联公共交通支付线索。','GREEN_CONSENT_REQUIRED',409);
}
function find(state,id){const goal=goals(state).find(g=>g.id===id);if(!goal)fail('未找到本账户的行动目标。','GREEN_GOAL_NOT_FOUND',404);return goal;}
function editable(state,goal){if(goal.cancelledAt||greenDay(state.now)>goal.endDate)fail('这个目标已结束，可重新开始一个7天目标。','GREEN_GOAL_ENDED',409);}

function view(state,goal){
  const today=greenDay(state.now),sources=new Map();
  const cutoff=Math.min(Date.parse(state.now),goal.cancelledAt?Date.parse(goal.cancelledAt):Infinity);
  for(const date of goal.records??[])if(date>=goal.startDate&&date<=goal.endDate&&date<=today)sources.set(date,{manual:true,transactionIds:[]});
  const linked=goal.useBankRecords===true&&state.green?.consent===true;
  if(linked){
    const months=new Set([goal.startDate.slice(0,7),goal.endDate.slice(0,7)]);
    for(const month of months){
      if(month>today.slice(0,7))continue;
      for(const evidence of greenReport(state,month).evidence){
        const date=greenDay(evidence.date);
        if(!evidence.rated||evidence.category!=='public_transport'||date<goal.startDate||date>goal.endDate||date>today||Date.parse(evidence.date)>cutoff)continue;
        const source=sources.get(date)??{manual:false,transactionIds:[]};
        if(!source.transactionIds.includes(evidence.transactionId))source.transactionIds.push(evidence.transactionId);
        sources.set(date,source);
      }
    }
  }
  const days=Array.from({length:7},(_,n)=>{
    const date=shift(goal.startDate,n),source=sources.get(date);
    return {date,isToday:date===today,future:date>today,done:!!source,manual:source?.manual??false,transactionIds:source?.transactionIds??[]};
  });
  const completedDays=days.filter(d=>d.done).length;
  const status=goal.cancelledAt?'cancelled':completedDays>=goal.targetDays?'completed':today>goal.endDate?'ended':'active';
  const feedback=status==='cancelled'?'已结束记录，随时可以重新开始。':status==='completed'?`已记录${completedDays}个行动日，达成这次小目标。`:status==='ended'?`这7天记录了${completedDays}天。下次可以从${Math.max(1,Math.min(completedDays,goal.targetDays-1))}天开始。`:completedDays?`已记录${completedDays}天，每一次适合自己的选择都值得肯定。`:'从今天的一次行动开始，不必改变所有习惯。';
  return {id:goal.id,type:goal.type,title:TYPES[goal.type],startDate:goal.startDate,endDate:goal.endDate,targetDays:goal.targetDays,
    useBankRecords:goal.useBankRecords,bankLinked:linked,completedDays,status,days,feedback,updatedAt:goal.updatedAt,
    manualDays:days.filter(d=>d.manual).length,bankDays:days.filter(d=>d.transactionIds.length>0).length};
}
export function greenGoals(state){
  const all=goals(state).map(g=>view(state,g)).reverse();
  const current=all.find(g=>g.status!=='cancelled'&&g.endDate>=greenDay(state.now))??null;
  return {today:greenDay(state.now),asOf:state.now,consent:state.green?.consent===true,current,history:all.filter(g=>g.id!==current?.id).slice(0,5)};
}
export function createGreenGoal(state,body){
  validate(body,['type','targetDays','useBankRecords']);
  if(!Object.hasOwn(TYPES,body.type))fail('请选择公共交通、步行骑行或随手节能。');
  target(body.targetDays);const useBankRecords=body.useBankRecords??false;link(state,body.type,useBankRecords);
  if(greenGoals(state).current)fail('已有进行中的7天目标，可以先调整或结束它。','GREEN_GOAL_EXISTS',409);
  const startDate=greenDay(state.now);
  const goal={id:'green-week-'+randomUUID(),type:body.type,targetDays:body.targetDays,useBankRecords,startDate,endDate:shift(startDate,6),records:[],createdAt:state.now,updatedAt:state.now};
  state.green??={consent:false,overrides:{},preferences:{}};state.green.weeklyGoals??=[];state.green.weeklyGoals.push(goal);
  appendAudit(state,'green_weekly_goal_created',{goalId:goal.id,type:goal.type,targetDays:goal.targetDays,useBankRecords});
  return greenGoals(state);
}
export function recordGreenGoal(state,body){
  validate(body,['goalId','date','action']);const goal=find(state,body.goalId);editable(state,goal);
  if(typeof body.date!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(body.date)||!Number.isFinite(Date.parse(body.date+'T00:00:00Z'))||shift(body.date,0)!==body.date||body.date<goal.startDate||body.date>goal.endDate||body.date>greenDay(state.now))fail('只能记录目标开始后、今天及以前的有效日期。');
  if(!['add','remove'].includes(body.action))fail('请选择记录或撤销手动记录。');
  const has=goal.records.includes(body.date);
  if((body.action==='add')!==has){
    goal.records=body.action==='add'?[...goal.records,body.date].sort():goal.records.filter(d=>d!==body.date);goal.updatedAt=state.now;
    appendAudit(state,'green_weekly_goal_recorded',{goalId:goal.id,date:body.date,action:body.action,source:'self_report'});
  }
  return greenGoals(state);
}
export function updateGreenGoal(state,body){
  validate(body,['goalId','targetDays','useBankRecords']);const goal=find(state,body.goalId);editable(state,goal);
  if(body.targetDays===undefined&&body.useBankRecords===undefined)fail('请提供要调整的目标。');
  if(body.targetDays!==undefined)target(body.targetDays);
  if(body.useBankRecords!==undefined)link(state,goal.type,body.useBankRecords);
  if(body.targetDays!==undefined)goal.targetDays=body.targetDays;
  if(body.useBankRecords!==undefined)goal.useBankRecords=body.useBankRecords;
  goal.updatedAt=state.now;appendAudit(state,'green_weekly_goal_updated',{goalId:goal.id,targetDays:goal.targetDays,useBankRecords:goal.useBankRecords});
  return greenGoals(state);
}
export function cancelGreenGoal(state,body){
  validate(body,['goalId']);const goal=find(state,body.goalId);
  if(!goal.cancelledAt){goal.cancelledAt=state.now;goal.updatedAt=state.now;appendAudit(state,'green_weekly_goal_cancelled',{goalId:goal.id});}
  return greenGoals(state);
}
