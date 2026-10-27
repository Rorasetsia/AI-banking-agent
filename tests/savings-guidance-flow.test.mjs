import test from 'node:test';
import assert from 'node:assert/strict';
import {createSeed} from '../server/seed.mjs';
import {savingsTurn,isSavingsRequest} from '../server/savings-agent.mjs';
const text='今年年底新增攒10万，月收入12000元，每月支出4000元，从本月开始';
test('从同一目标的优选方案重算后预算可行，资金状态不变',()=>{
 const state=createSeed('guidance-flow');const funds=JSON.stringify([state.account,state.transactions,state.plans]);
 let view=savingsTurn(state,text).agent;
 assert.equal(view.savings.guidance.preferred.actionId,'extend');
 const action=view.actions.find(a=>a.id===view.savings.guidance.preferred.actionId);
 view=savingsTurn(state,action.text).agent;
 assert.equal(view.savings.feasible,true);assert.equal(view.savings.targetCents,10000000);
 assert.ok(view.savings.monthlyPlannedCents<=800000);
 assert.equal(JSON.stringify([state.account,state.transactions,state.plans]),funds);
});
test('用户明确期限与金额限制后优选顺序随之变化，并能解除限制',()=>{
 const state=createSeed('constraints-flow');savingsTurn(state,text);
 assert.equal(isSavingsRequest('期限不能延后',state),true);
 let view=savingsTurn(state,'期限不能延后').agent;
 assert.equal(view.savings.guidance.preferred.actionId,'adjust-target');
 view=savingsTurn(state,'目标金额也不能降低').agent;
 assert.ok(!['extend','adjust-target'].includes(view.savings.guidance.preferred?.actionId));
 assert.ok(view.savings.guidance.lastResort);
 view=savingsTurn(state,'期限可以调整，可以延期').agent;
 assert.equal(view.savings.guidance.preferred.actionId,'extend');
});
test('没有月结余时给收支入口；本金已足够时无需追加存钱',()=>{
 let state=createSeed('no-surplus');
 let view=savingsTurn(state,'今年年底新增攒2万，月收入3000元，每月支出4000元，从本月开始').agent;
 assert.equal(view.savings.guidance.status,'cashflow');
 assert.equal(view.savings.guidance.preferred.actionId,'bills');
 assert.equal(view.savings.monthlyPlannedCents,0);
 state=createSeed('covered');
 view=savingsTurn(state,'今年年底累计总额1万，现有存款2万，应急金5000，月收入3000元，每月支出4000元，从本月开始').agent;
 assert.equal(view.savings.guidance.status,'covered');assert.equal(view.savings.monthlyPlannedCents,0);
});
