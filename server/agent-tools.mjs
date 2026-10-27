import { analyze } from './analytics.mjs';
import { unsafe } from './rules.mjs';
import { clarificationQuestions } from './clarification-ui.mjs';

const money = n => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(n / 100);
const action = (id, label, route) => ({ id, label, kind: 'navigate', route });
const ask = (id, label, text) => ({ id, label, kind: 'send', text });
const view = (title, summary, facts = [], actions = []) => ({
  kind: 'banking', stage: 'completed', title, summary, facts, actions, questions: [],
  steps: [{ label: '理解需求', status: 'done' }, { label: '核对账户信息', status: 'done' }, { label: '选择下一步', status: 'current' }],
});

export function agentTaskBundle(text, state) {
  if(unsafe(text) || !/(?:再|然后|顺便|同时|并且|以及|先)/.test(text))return null;
  const clauses=text.split(/(?:然后|顺便|同时|并且|以及|，再|,再|再帮我|再给我|再做)/).map(s=>s.trim()).filter(Boolean);
  const goals=clauses.filter(s=>/(?:攒|存钱|储蓄)/.test(s));
  const writes=clauses.filter(s=>/(?:取消.{0,8}(?:会员|订阅|代扣)|(?:给|向).{1,12}转|申购|赎回|挂失|锁卡)/.test(s));
  const readRequested=/(?:分析|梳理|检查|看看).{0,12}(?:账单|收支|开销)/.test(text);
  if(!goals.length || (!writes.length&&!readRequested) || clauses.length<2)return null;
  const report=readRequested?agentOverview(state,'cashflow'):null;
  const summary='我把这次安排拆开：先核对现有信息，再补齐储蓄条件；资金或授权变更单独给你方案确认。';
  const steps=[...(report?[{label:'核对本月收支',status:'done'}]:[]),{label:'明确储蓄目标与月预算',status:'current'},...writes.map(()=>({label:'核对所需办理方案',status:'pending'})),{label:'确认执行与查看凭证',status:'pending'}];
  return {reply:[summary,report?.reply,'请选择先继续哪一步；本次没有取消订阅、转账或购买理财。'].filter(Boolean).join('\n'),
    agent:{kind:'banking',stage:'clarifying',title:'把一句话的安排拆成可办理步骤',summary,steps,facts:report?.agent.facts??[],questions:[],
      actions:[...goals.slice(0,1).map((s,i)=>ask(`goal-${i}`,'继续存钱规划',s.replace(/^先/,''))),...writes.slice(0,3).map((s,i)=>ask(`write-${i}`,'核对'+s.slice(0,12),s.replace(/^先/,''))),action('tasks','查看已有任务','tasks')]},
    trace:['识别跨场景任务，按权限拆分',...(report?.trace??[]),'写操作仍需独立确认'],sources:report?.sources};
}

export function agentTopic(text, state) {
  if (unsafe(text)) return null;
  // A reply to an existing bank clarification belongs to that task.
  if (state.pending && !/(?:能做什么|有什么能力|任务进度)/.test(text)) return null;
  if (/(?:有什么|能做什么|可以做什么|帮什么|怎么用|使用帮助|你是谁)/.test(text) || /^(?:你好|您好|嗨|hello)[！!。\s]*$/i.test(text)) return 'capabilities';
  if (/(?:任务|计划|办理).{0,8}(?:进度|结果|状态|到哪|怎么样)|(?:有哪些|查看|看看|梳理).{0,5}(?:待办|待确认|预约任务)/.test(text)) return 'tasks';
  if (/(?:财务|现金流|收支|开销|花销|花钱|支出|账单).{0,12}(?:梳理|整理|建议|优化|省钱|怎么|如何)|(?:梳理|整理|诊断|规划|分析|看看).{0,12}(?:财务|现金流|收支|开销|花销)|钱.{0,5}(?:花哪|去哪)|(?:能|可以).{0,4}省.{0,4}钱/.test(text)) return 'cashflow';
  if (/(?:理财|基金|投资).{0,10}(?:怎么选|如何选|适不适合|适合我|有什么区别|风险|建议)|(?:推荐|选择).{0,6}(?:理财|基金)/.test(text)) return 'products';
  return null;
}

export function agentOverview(state, topic = 'capabilities') {
  const available = state.account.balanceCents - state.account.reservedCents;
  if (topic === 'cashflow') {
    const month = new Date(Date.parse(state.now) + 8 * 3600000).toISOString().slice(0, 7);
    const filtered = { ...state, transactions: state.transactions.filter(t => Date.parse(t.date) <= Date.parse(state.now)) };
    const report = analyze(filtered, { month });
    const categories = report.consumptionCategories.slice(0, 3);
    const categoryNote = categories.length ? categories.map(c => `${c.name}${money(c.amountCents)}`).join('、') : '本期消费记录不足';
    const summary = `${month}已入账流入${money(report.incomeCents)}、流出${money(report.expenseCents)}，净流入${money(report.netCents)}。主要消费：${categoryNote}。`;
    return {
      reply: `${summary}\n我建议先核对账单是否包含房租等必要转账，再检查持续扣费，最后按你能承受的月度结余安排储蓄。流水净流入包含转账等资金变动，不等于工资或可持续可存金额；不建议仅凭这份记录承诺节省额度。${report.anomalies.length ? `发现${report.anomalies.length}条需核对线索，不代表欺诈。` : ''}`,
      agent: view('先看清开销，再决定怎么省', summary, [
        { label: '可用余额', value: money(available), source: '当前模拟环境账户，已减去预留' },
        { label: '数据范围', value: `${month}，${report.count}笔流水`, source: '当前模拟环境日期之前的本账户记录' },
        { label: '需核对线索', value: `${report.anomalies.length}条`, source: '账单规则检查，非欺诈判断' },
      ], [action('bills', '核对原始账单', 'bills'), ask('subscriptions', '检查持续扣费', '检查重复扣款和扣费异常'), ask('save', '做一份存钱计划', '帮我做一份存钱计划')]),
      trace: ['读取本用户本月流水，排除未来记录', '计算收支与分类，未执行资金操作'], sources: report.sources,
    };
  }
  if (topic === 'tasks') {
    const pending = state.plans.filter(p => p.status === 'pending' && Date.parse(p.expiresAt) > Date.now() && Date.parse(p.demoExpiresAt) > Date.parse(state.now));
    const scheduled = state.schedules.filter(s => s.status === 'scheduled');
    const receipts = state.plans.filter(p => p.receipt);
    const summary = `${pending.length}份方案待确认，${scheduled.length}项预约待执行，${receipts.length}份已办理凭证。`;
    return { reply: `${summary}待确认不代表已扣款；预约依赖模拟环境时钟或请求扫描，不保证关页后后台执行。你可以到“预约与凭证”核对、取消待办或查看结果。`, agent: view('核对任务进度', summary, [
      { label: '待确认', value: `${pending.length}份`, source: '当前有效计划' },
      { label: '预约中', value: `${scheduled.length}项`, source: '当前预约状态' },
    ], [action('tasks', '查看预约与凭证', 'tasks')]), trace: ['读取当前本用户计划、预约和凭证，未执行任何操作'], sources: { asOf: state.now, planIds: pending.map(p => p.id) } };
  }
  if (topic === 'products') {
    const assessed = state.risk?.questionnaireVersion === 2;
    const summary = assessed ? `当前项目演示风险档位R${state.risk.level}。先说明用途和多久要用钱，再比较产品。` : '先明确用钱期限和承受能力，个性化配置前需要完成风险问卷。';
    return { reply: `${summary}目录包含${state.products.map(p => `${p.name}（${p.category}，演示R${p.riskLevel}）`).join('、')}。货币基金也不等于银行存款或保本承诺。短期要用的钱不宜依赖股票基金涨幅来完成目标；这里没有实时收益或收益预测。`,
      agent: view('从资金用途开始比较理财', summary, state.products.map(p => ({ label: p.name, value: `${p.category} · 演示R${p.riskLevel}`, source: '现有基金资料目录；价格/份额为模拟' })), [action('wealth', assessed ? '查看产品与风险说明' : '填写问卷与比较产品', 'wealth'), ask('goal', '结合储蓄目标规划', '我想结合理财做一份存钱计划')]), trace: ['读取产品目录与本用户风险评估，未申购'], sources: { productIds: state.products.map(p => p.id), asOf: state.now } };
  }
  const summary = '把你要达成的目标告诉我。我会先核对信息、问清缺项，给出方案；涉及办理时再请你确认。';
  return { reply: `${summary}\n例如：年底攒十万元、梳理开销、安排转账、检查订阅扣费、比较理财、管理卡片或安排生日预算。你可以随时修改条件、只做比较或取消待确认计划。资金操作仍需交易密码和设备验证；这里是独立模拟银行。`,
    agent: view('从目标开始，把事情办清楚', summary, [], [ask('savings', '今年攒十万', '我今年要攒十万块'), ask('cashflow', '梳理本月开销', '帮我梳理本月开销，看看能怎么省钱'), ask('subscription', '检查扣费', '检查重复扣款和扣费异常'), action('tasks', '查看办理进度', 'tasks')]), trace: ['解释当前可用能力，未创建执行计划'] };
}

export function decorateAgentResult(state, result, intent) {
  if (!result || result.agent) return result;
  if (result.plan) {
    const plan = result.plan;
    return { ...result, agent: {
      kind: 'banking', stage: 'awaiting_confirmation', title: plan.title, summary: '方案已准备好，核对并完成安全验证后才会执行。',
      steps: [{ label: '理解需求', status: 'done' }, { label: '检查执行条件', status: 'done' }, { label: '核对并确认', status: 'current' }, { label: '执行与凭证', status: 'pending' }],
      facts: plan.steps.map(s => ({ label: s.label, value: '待你确认', source: '服务端已校验的办理方案' })), questions: [], actions: [action('tasks', '查看统一任务入口', 'tasks')],
    } };
  }
  if (result.clarification) return { ...result, agent: {
    kind: 'banking', stage: 'clarifying', title: '先补齐这次任务的信息', summary: result.clarification.question,
    steps: [{ label: '理解需求', status: 'done' }, { label: '补充信息', status: 'current' }, { label: '生成方案', status: 'pending' }],
    facts: [], questions: [], clarifications: result.clarification.questions ?? clarificationQuestions(state,{...result.clarification,intent}), actions: [ask('stop', '取消本次追问', '取消')],
  } };
  const routes = { analytics: 'bills', account: 'accounts', wealth_compare: 'wealth', subscription_list: 'subscriptions', card_list: 'cards' };
  const route = routes[intent?.kind];
  if (route) return { ...result, agent: view('已核对可用信息', '结果来自当前账户与资料目录。下一步由你选择。', [], [action('detail', '查看详情与后续操作', route), action('tasks', '查看已有任务', 'tasks')]) };
  return result;
}
