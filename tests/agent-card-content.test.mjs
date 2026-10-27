import test from 'node:test';import assert from 'node:assert/strict';
import {createSeed} from '../server/seed.mjs';import {agentOverview,decorateAgentResult} from '../server/agent-tools.mjs';
test('开销卡片包含可突出展示的关键流量，与回复属于同一报告',()=>{
 const state=createSeed('card-data');const before=JSON.stringify([state.account,state.transactions,state.plans]);
 const result=agentOverview(state,'cashflow');assert.equal(result.agent.highlights.length,3);
 assert.deepEqual(result.agent.highlights.map(x=>x.label),['本月流入','本月流出','净流入']);
 for(const item of result.agent.highlights)assert.ok(result.reply.includes(item.value));
 assert.equal(JSON.stringify([state.account,state.transactions,state.plans]),before);
});
test('多业务计划共享任务卡，不改变服务端核对的操作内容',()=>{
 const state=createSeed('plan-card');
 for(const tool of ['transfer','card_lock','wealth_buy']){
  const plan={id:tool,title:'核对操作',steps:[{tool,params:{},label:'待核对'}]};
  const result=decorateAgentResult(state,{reply:'尚未执行',plan},{kind:'transfer'});
  assert.equal(result.plan,plan);assert.equal(result.agent.stage,'awaiting_confirmation');assert.equal(result.agent.facts[0].label,'待核对');
 }
});
