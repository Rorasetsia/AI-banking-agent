import test from 'node:test';import assert from 'node:assert/strict';
import {buildSavingsGuidance,readSavingsConstraints} from '../server/savings-guidance.mjs';
const actions=[{id:'extend',label:'延至2027-10',text:'完成期限改为2027-10-31'},{id:'adjust-target'},{id:'save'},{id:'bills'}];
const base={gapCents:10000000,monthlyCapacityCents:800000,monthlyRequiredCents:3333334,monthlyPlannedCents:800000,feasible:false,atDeadlineCents:2400000,shortfallAtDeadlineCents:7600000};
test('优选随约束变化，输入投影不被修改',()=>{
 const before=JSON.stringify(base);assert.equal(buildSavingsGuidance(base,actions).preferred.actionId,'extend');
 assert.equal(buildSavingsGuidance(base,actions,{keepDeadline:true}).preferred.actionId,'adjust-target');
 assert.equal(buildSavingsGuidance(base,actions,{keepTarget:true}).preferred.actionId,'extend');
 const both=buildSavingsGuidance(base,actions,{keepTarget:true,keepDeadline:true});assert.equal(both.preferred.actionId,'bills');assert.match(both.lastResort.body,/没有可行/);assert.equal(JSON.stringify(base),before);
 assert.equal(buildSavingsGuidance(base,actions.filter(a=>a.id!=='extend')).preferred.actionId,'adjust-target');
});
test('可达、低余量、无结余、未知与已覆盖分别处理',()=>{
 assert.equal(buildSavingsGuidance({...base,feasible:true,monthlyPlannedCents:500000},actions).status,'on_track');
 assert.equal(buildSavingsGuidance({...base,feasible:true,monthlyPlannedCents:780000},actions).status,'tight');
 for(const monthlyCapacityCents of [0,-100000])assert.equal(buildSavingsGuidance({...base,monthlyCapacityCents},actions).status,'cashflow');
 assert.equal(buildSavingsGuidance({...base,monthlyCapacityCents:null},actions).status,'needs_input');
 assert.equal(buildSavingsGuidance({...base,gapCents:0,monthlyPlannedCents:0,monthlyCapacityCents:-100},actions).status,'covered');
});
test('不同金额与期限使用真实投影，不固定十万元案例',()=>{
 const g=buildSavingsGuidance({...base,monthlyCapacityCents:120000,atDeadlineCents:720000,shortfallAtDeadlineCents:180000},actions,{keepDeadline:true});
 assert.match(g.preferred.reason,/7,200/);assert.match(g.explanation,/1,800/);assert.doesNotMatch(g.explanation,/76,000/);
});
test('明确限制与解除限制识别，普通对话不改变已有取舍',()=>{
 assert.deepEqual(readSavingsConstraints('期限不能延后，目标金额也不能降低'),{keepDeadline:true,keepTarget:true});
 assert.deepEqual(readSavingsConstraints('期限可以调整，可以延期',{keepDeadline:true,keepTarget:true}),{keepDeadline:false,keepTarget:true});
 assert.deepEqual(readSavingsConstraints('不必按时，可以降低目标',{keepDeadline:true,keepTarget:true}),{keepDeadline:false,keepTarget:false});
 assert.equal(readSavingsConstraints('收入12000'),null);assert.equal(readSavingsConstraints('目标可以不变'),null);
});
