import { randomUUID, createHash } from 'node:crypto';
import { parseAmount, parseRules, unsafe } from './rules.mjs';
import {budgetProjection,simulateSavings} from './savings-scenarios.mjs';
import {RISK_QUESTIONNAIRE} from './risk-assessment.mjs';

const money = n => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(n / 100);
const day = value => new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 10);
const shift = (month, delta) => {
  const [y, m] = month.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
};
const number = '(-?\\d[\\d,]*(?:\\.\\d+)?(?:万|千|百|亿|[wk])?|[零〇一二两三四五六七八九十百千万亿点]+)';
const unit = '(?:块钱|块|元|人民币)?';
const send = (id, label, text = label) => ({ id, label, kind: 'send', text });
const navigate = (id, label, route) => ({ id, label, kind: 'navigate', route });
const fiscalKeys = ['targetCents', 'startingCents', 'emergencyCents', 'monthlyIncomeCents', 'monthlyExpenseCents'];
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function ensure(state) {
  state.savingsAgent ??= { draft: null, savedPlans: [] };
  if (!Array.isArray(state.savingsAgent.savedPlans)) state.savingsAgent.savedPlans = [];
  return state.savingsAgent;
}

export function savingsSnapshot(state) {
  const data = state.savingsAgent ?? { draft: null, savedPlans: [] };
  return structuredClone({ draft: data.draft, savedPlans: data.savedPlans ?? [] });
}

function explicitGoal(text) {
  return /(?:攒|存钱|存款目标|储蓄|积蓄|积累资金|攒够|攒下|存够|存到|存下|存满|存\s*[零〇一二两三四五六七八九十百千万亿\d]|储备一笔|累计总额|新增存入|年底目标)/.test(text)
    && !/(?:存款利率|存款保险|从.*卡.*存入|存款产品)/.test(text);
}

export function isSavingsRequest(text, state) {
  if (unsafe(text)) return false;
  // Existing bank clarifications and explicit writing requests retain ownership.
  if (/(?:预留|释放预留|转账|转给|申购|赎回|买入|购买基金|锁卡|解锁|挂失|取消代扣|监测|绿色|通勤|换新)/.test(text)) return false;
  if (state.pending && !explicitGoal(text)) return false;
  if (explicitGoal(text) || /(?:保存|查看|取消|修改).{0,8}(?:存钱|储蓄)计划/.test(text)) return true;
  if (/(?:任务|办理|计划).{0,8}(?:进度|状态|结果)|能做什么|有什么能力|你是谁|^(?:你好|您好|嗨|hello)[！!。\s]*$/i.test(text)) return false;
  const draft = state.savingsAgent?.draft;
  if (!draft?.active) return false;
  if(/(?:收益|年化)|(?:理财|投资).{0,12}(?:达标|目标|能帮|攒够)/.test(text)&&!/(?:查看|查询).{0,8}(?:持仓|交易|账户收益)/.test(text))return true;
  const explicitQuery=/(?:分析|查看|查询|统计|看看).{0,12}(?:账单|流水|余额|账户|收入|支出)/.test(text);
  if(/^(?:先不|不要|不考虑|不做|只做|结合|考虑|包含).{0,4}(?:理财|投资|规划|比较)/.test(text))return true;
  if(!explicitQuery && (Object.keys(readInput(text,state,draft).input).length>0 || /按账单|用账单|根据账单|确认采用(?:账单)?粗估/.test(text)))return true;
  const intent = parseRules(text, state);
  return ['clarify', 'help'].includes(intent.kind) || /^(?:取消|算了|停止|不用了)[吧了。！!\s]*$/.test(text);
}

function readInput(text, state, draft) {
  const input = {};
  const errors = [];
  const sources = {};
  if(/还是|或者|或是/.test(text) && (text.match(new RegExp(number,'g'))??[]).length>1)return {input,sources,errors:['金额存在多个候选，请先明确采用哪个数额；本次没有更新条件。']};
  function capture(key, prefix) {
    const regex = new RegExp(prefix + '\\s*(?:改成|改为|调整为|是|为|到|有|约|大约|大概|共|共计|[:：])?\\s*' + number + '\\s*' + unit + '(?=\\s*(?:[，,。；;！!？?]|$|用于|作为|应急|以内|左右|整|以上|以下|还有|并|且|月入|每月|现有|收入|支出|从))', 'i');
    const match = regex.exec(text);
    if (!match) return;
    const value = parseAmount(match[1]);
    if (!Number.isSafeInteger(value) || value < 0 || value > 100_000_000_000 || (key === 'targetCents' && value === 0)) {
      errors.push(`${key === 'targetCents' ? '目标' : '收支或本金'}金额需为有效的非负金额，最多两位小数；目标须大于0。`);
      return;
    }
    input[key] = value;
    sources[key] = `用户本次输入“${match[0].trim()}”`;
  }
  capture('targetCents', '(?:目标(?:金额)?|累计总额|总额|总共|攒(?:够|到|下|满)?|存(?:够|到|下|满)?|新增(?:攒|存)?)');
  if (!own(input, 'targetCents') && /(?:目标|攒|存钱)/.test(text)) {
    const match = new RegExp(number + '\\s*(?:元|块钱|块)?(?:的)?(?:存钱|储蓄|攒钱)目标').exec(text);
    if (match) {
      const value = parseAmount(match[1]);
      if (Number.isSafeInteger(value) && value > 0 && value <= 100_000_000_000) { input.targetCents = value; sources.targetCents = '用户明确的储蓄目标'; }
    }
  }
  if (!own(input, 'targetCents') && draft?.input?.targetCents && /^(?:改成|改为|调整为)/.test(text)) capture('targetCents', '(?:改成|改为|调整为)');
  capture('monthlyIncomeCents', '(?:月入|月薪|每月(?:的)?(?:收入|工资|到手)|月收入|收入每月|收入|工资|到手)');
  capture('monthlyExpenseCents', '(?:每月(?:的)?(?:必要|固定)?(?:支出|开销|花销|生活费)|月(?:支出|开销)|(?:必要|固定)(?:支出|开销)|支出|开销|花销|生活费)');
  capture('startingCents', '(?:现有(?:可计入)?(?:存款|存钱|本金|积蓄|储蓄)?|已有(?:存款|本金|积蓄)?|目前(?:存款|积蓄)|可计入(?:本金|存款)|本金|存款|手头|手里)');
  capture('emergencyCents', '(?:应急(?:金|储备)?(?:留|保留)?|保留(?:的)?应急金|留出(?:的)?应急金)');
  // Explicit zero statements are distinct from an unknown amount.
  if (/(?:没有|暂无|无)(?:现有)?(?:存款|积蓄|本金)/.test(text)) { input.startingCents = 0; sources.startingCents = '用户说明暂无本金'; }
  if (/(?:不留|无需保留|不用留|没有|暂不留)(?:应急金|应急储备)/.test(text)) { input.emergencyCents = 0; sources.emergencyCents = '用户明确暂不保留应急金'; }
  if (/新增|再攒|再存|额外攒|额外存/.test(text)) input.mode = 'additional';
  else if (/累计|总额|总共|总资产达到|年底达到|达到总/.test(text)) input.mode = 'total';
  if (input.mode) sources.mode = '用户明确目标口径';
  const today = day(state.now), year = Number(today.slice(0, 4)), month = today.slice(0, 7);
  const fullDate = /(?:截止|截至|到|期限|目标日期|年底前|在)?\s*(20\d{2})[-年/.](\d{1,2})[-月/.](\d{1,2})(?:日|号)?/.exec(text);
  if (fullDate) input.deadline = `${fullDate[1]}-${fullDate[2].padStart(2, '0')}-${fullDate[3].padStart(2, '0')}`;
  else if (/明年(?:年底|年末|底|末)/.test(text)) input.deadline = `${year + 1}-12-31`;
  else if (/(?:今年|本年|年底|年末)/.test(text)) input.deadline = `${year}-12-31`;
  if (input.deadline) sources.deadline = `用户期限，按模拟环境日期${today}解释`;
  const start = /从\s*(20\d{2})[-年/.](\d{1,2})月?(?:开始|起)/.exec(text);
  if (start) input.startMonth = `${start[1]}-${start[2].padStart(2, '0')}`;
  else if (/从?(?:下个?月|下月)(?:开始|起|存)/.test(text)) input.startMonth = shift(month, 1);
  else if (/从?(?:本月|这个月|当月)(?:开始|起|存)/.test(text)) input.startMonth = month;
  if (input.startMonth) sources.startMonth = '用户明确起始月份';
  return { input, sources, errors };
}

function ledgerEstimate(state) {
  const current = day(state.now).slice(0, 7);
  const months = [shift(current, -3), shift(current, -2), shift(current, -1)];
  const seen = new Set();
  const rows = (state.transactions ?? []).filter(t => {
    if (seen.has(t.id) || !Number.isSafeInteger(t.amountCents) || !Number.isFinite(Date.parse(t.date))) return false;
    seen.add(t.id);
    return months.includes(day(t.date).slice(0, 7)) && !['wealth', 'own_deposit', 'own_withdraw'].includes(t.kind) && t.category !== '理财';
  });
  const incomeRows = rows.filter(t => t.amountCents > 0 && /income|salary/.test(t.kind) && !/退款|赎回|借款|贷款/.test(`${t.memo} ${t.merchant}`));
  const spending = rows.filter(t => t.amountCents < 0);
  // Sparse data is labelled an estimate. All cash outflows including rent and
  // transfers count here; this is not the consumption-only analytics metric.
  if (months.some(m => !incomeRows.some(t => day(t.date).startsWith(m)))) return null;
  return { monthlyIncomeCents: Math.round(incomeRows.reduce((s, t) => s + t.amountCents, 0) / 3),
    monthlyExpenseCents: Math.round(spending.reduce((s, t) => s - t.amountCents, 0) / 3),
    months, transactionIds: rows.map(t => t.id), count: rows.length };
}

function productChoices(state, months) {
  return (state.products ?? []).map(product => {
    const assessed = riskStatus(state)==='current';
    const short = months < 12 && (/股票|混合/.test(product.category ?? '') || product.riskLevel >= 3);
    const eligible = assessed && product.riskLevel <= state.risk.level && !short;
    const reason = !assessed ? riskStatus(state)==='expired'?'风险问卷已过期，需更新后再比较。':'尚未完成现版风险问卷，仅展示目录，不提供个性化配置。'
      : short ? '目标期限较短，不将这类波动产品作为目标资金候选。'
      : product.riskLevel > state.risk.level ? '超过当前项目演示风险档位。'
      : '可进一步比较用途与流动性；不代表适合购买，不计入目标收益。';
    return { id: product.id, name: product.name, code: product.code, riskLevel: product.riskLevel, eligible, reason, officialUrl: product.officialUrl };
  });
}

function riskStatus(state){
  if(state.risk?.questionnaireVersion!==RISK_QUESTIONNAIRE.version)return 'required';
  const age=Date.parse(state.now)-Date.parse(state.risk.assessedAt);
  return Number.isFinite(age)&&age>=0&&age<=365*86400000?'current':'expired';
}

function projection(state, input) {
  const { targetCents, startingCents, emergencyCents, mode, deadline, startMonth } = input;
  const months = [];
  for (let month = startMonth; month <= deadline.slice(0, 7) && months.length <= 120; month = shift(month, 1)) months.push(month);
  const usableStartingCents = mode === 'additional' || startingCents === 0 ? 0 : Math.max(0, startingCents - emergencyCents);
  const gapCents = Math.max(0, mode === 'additional' ? targetCents : targetCents - usableStartingCents);
  const monthlyRequiredCents = Math.ceil(gapCents / months.length);
  const monthlyCapacityCents = own(input, 'monthlyIncomeCents') && own(input, 'monthlyExpenseCents') ? input.monthlyIncomeCents - input.monthlyExpenseCents : null;
  let left = gapCents;
  const base = mode === 'additional' ? 0 : usableStartingCents;
  let cumulative = base;
  const schedule = months.map(month => {
    const amountCents = Math.min(left, monthlyRequiredCents); left -= amountCents; cumulative += amountCents;
    return { month, amountCents, cumulativeCents: cumulative };
  });
  const warnings = ['基础计划按投资收益0计算，不保证达成；基金可能亏损，不能用预期收益填补储蓄缺口。', '这是独立模拟环境规划，保存目标不会预留资金、购买理财或设置自动转账。'];
  if (mode !== 'additional' && emergencyCents > startingCents) warnings.push('应急储备高于现有本金，本期可计入目标的本金按0计算；需先补足应急储备。');
  if (mode === 'additional') warnings.push('新增目标不询问或动用现有存款。请在月度必要支出中预留生活和应急所需，再核对可存金额。');
  if (monthlyCapacityCents !== null && monthlyCapacityCents < monthlyRequiredCents) warnings.push('当前预算不足以按期完成：可以降低目标、延长期限或核对可调整支出，不建议靠高风险收益补差。');
  return { targetCents, mode, startingCents: startingCents ?? null, emergencyCents: emergencyCents ?? null, usableStartingCents, gapCents, monthlyRequiredCents,
    monthlyIncomeCents:input.monthlyIncomeCents??null,monthlyExpenseCents:input.monthlyExpenseCents??null,
    monthlyCapacityCents, monthlyGapCents: monthlyCapacityCents === null ? null : gapCents===0?0:Math.max(0, monthlyRequiredCents - monthlyCapacityCents),
    deadline, startMonth, months: months.length, feasible: gapCents===0?true:monthlyCapacityCents === null ? null : monthlyCapacityCents >= monthlyRequiredCents,
    schedule, products: productChoices(state, months.length), warnings,
    assumptions: [`按模拟环境日期${day(state.now)}解释期限，起始月计一次月度存入，截止月计一次；不是自动扣款日程。`,
      mode === 'additional' ? '目标为新增存入额，现有本金不抵扣目标；未采集的存款和应急金不代表为0。' : '目标为累计总额，现有本金扣除应急储备后计入。',
      '收入和必要支出按确认的月预算，不代表稳定收入保证；本账户以外的存款来自用户自报。',
      '基金名称/代码来自现有公开资料目录，净值、份额和风险档位为项目演示，不是实时行情。'] };
}

function clarification(key, input = {}) {
  const moneyField = (id, label, prefix, placeholder = '请输入金额，可填0') => ({id,label,prefix,placeholder,type:'money'});
  const definitions = {
    targetCents: {id:key,label:'你希望攒到多少？',fields:[moneyField(key,'目标金额','储蓄目标','例如100000')]},
    deadline: {id:key,label:'希望在哪一天前完成？',fields:[{id:key,label:'完成日期',type:'date',prefix:'完成期限为'}]},
    mode: {id:key,label:'这笔目标怎么计算？',options:[
      {id:'total',label:'一共达到目标金额',detail:'包含已有存款，扣除应急储备后计入目标',reply:'我的目标是累计总额达到目标金额'},
      {id:'additional',label:'从现在起再攒这笔钱',detail:'从本月开始，现有存款不抵扣目标',reply:'我的目标是新增攒下这笔钱，从本月开始'}]},
    startingCents: {id:key,label:'现在已有多少存款？',hint:'填写与你这次目标有关的存款，下一步会单独核对应急金。',options:[{id:'none',label:'目前没有存款',reply:'没有存款'}],fields:[moneyField(key,'现有存款','现有存款','例如20000')]},
    emergencyCents: {id:key,label:'其中要留多少应急金？',hint:'这部分留作生活保障，不计入可用本金。',options:[{id:'none',label:'这次不从存款中另留应急金',detail:'由我明确选择为0元',reply:'应急金0元'}],fields:[moneyField(key,'应急储备','应急金','例如5000')]},
    cashflow: {id:key,label:'每月收入和必要支出是多少？',options:[{id:'ledger',label:'先用模拟环境账单粗估',detail:'先看估算结果，核对后再决定是否采用',reply:'先按账单估算收入和支出'}],fields:[
      ...(!own(input,'monthlyIncomeCents') ? [moneyField('monthlyIncomeCents','每月收入','月收入','例如10000')] : []),
      ...(!own(input,'monthlyExpenseCents') ? [moneyField('monthlyExpenseCents','每月必要支出','每月支出','例如4000')] : [])]},
    startMonth: {id:key,label:'从什么时候开始攒？',options:[{id:'this',label:'从本月开始',reply:'从本月开始'},{id:'next',label:'从下月开始',reply:'从下月开始'}]},
  };
  return definitions[key];
}

function makeView(state, draft, stage = 'clarifying', override) {
  const input = draft.input;
  const today=day(state.now);
  if(input.deadline && input.deadline<today)return {kind:'savings',stage:'clarifying',title:'这份目标需要重新核对期限',summary:`原期限${input.deadline}已早于模拟环境今天${today}。保存的计划不等于已完成，请设置新期限后重新计算。`,steps:[],facts:[],questions:['新的完成日期是哪一天？'],clarifications:[clarification('deadline')],actions:[send('stop','结束本次规划','取消这次储蓄规划')]};
  const missing = [];
  if (!own(input, 'targetCents')) missing.push(['targetCents', '你希望攒到多少元？']);
  if (!input.deadline) missing.push(['deadline', '希望在哪一天前完成？例如“今年年底”。']);
  if (!input.mode) missing.push(['mode', '是累计总额达到目标，还是从现在起新增攒下这笔钱？']);
  if (input.mode !== 'additional' && !own(input, 'startingCents')) missing.push(['startingCents', '现有多少可计入目标的存款？没有可以说“没有存款”。']);
  if (input.mode !== 'additional' && input.startingCents !== 0 && !own(input, 'emergencyCents')) missing.push(['emergencyCents', '这些存款中要保留多少应急金？请明确金额，可以为0。']);
  if (!own(input, 'monthlyIncomeCents') || !own(input, 'monthlyExpenseCents')) missing.push(['cashflow', '每月收入和必要支出各是多少？也可以选择先看账单粗估。']);
  if (!input.startMonth || input.startMonth<today.slice(0,7)) missing.push(['startMonth', '本月就开始存，还是从下月开始？已过去的月份不会自动算作已存入。']);
  const actions = [];
  const firstKeys = missing.slice(0, 2).map(m => m[0]);
  const clarifications = firstKeys.map(key => clarification(key, input));
  if(firstKeys.includes('mode'))for(const question of clarifications){
    if(['startingCents','emergencyCents'].includes(question.id))question.visibleWhen=[{questionId:'mode',optionIds:['additional'],not:true}];
  }
  if(firstKeys.includes('startingCents'))for(const question of clarifications){
    if(question.id==='emergencyCents')question.visibleWhen=[{questionId:'startingCents',optionIds:['none'],fieldId:'startingCents',values:['0'],not:true}];
  }
  const labels = { targetCents: '储蓄目标', startingCents: '现有本金', emergencyCents: '应急储备', monthlyIncomeCents: '月收入', monthlyExpenseCents: '月必要支出' };
  const facts = fiscalKeys.filter(key => own(input, key) && !(input.mode==='additional'&&['startingCents','emergencyCents'].includes(key))).map(key => ({ label: labels[key], value: money(input[key]), source: draft.sources[key] ?? '用户确认的信息' }));
  if (input.deadline) facts.push({ label: '完成期限', value: input.deadline, source: draft.sources.deadline ?? `模拟环境日期${day(state.now)}` });
  const title = input.targetCents ? `${money(input.targetCents)}存钱计划` : '一起做一份存钱计划';
  let savings;
  let summary = override || '先把目标和条件对齐，再计算每个月需要攒多少。';
  if (!missing.length) {
    savings = projection(state, input);
    Object.assign(savings,budgetProjection(savings));
    savings.riskStatus=riskStatus(state);
    savings.riskLevel=savings.riskStatus==='current'?state.risk.level:null;
    savings.simulation=savings.riskStatus==='current'&&savings.products.some(p=>p.eligible)&&!draft.excludeProducts
      ?simulateSavings(savings,input.annualScenarioBps??0,today):null;
    if(draft.excludeProducts)savings.products=[];
    stage = override ? 'clarifying' : stage === 'saved' ? stage : 'ready';
    summary = savings.feasible===false
      ?`这份目标按当前收支还做不到。每月收入减去必要支出后可存${money(Math.max(0,savings.monthlyCapacityCents??0))}，${savings.months}个月预计攒到${money(savings.atDeadlineCents??0)}，离目标还差${money(savings.shortfallAtDeadlineCents??0)}。可以先选下面的调整方式，也可以自己改条件。`
      :`按当前条件，每月安排${money(savings.monthlyPlannedCents??savings.monthlyRequiredCents)}，到${input.deadline}预计达到${money(savings.atDeadlineCents??input.targetCents)}。基础计划不计投资收益。`;
    if(override)summary=override+' 当前展示的是上次有效条件，请更正后再保存。';
    actions.push(send('save', stage === 'saved' ? '查看已保存目标' : savings.feasible===false?'保存当前目标，稍后调整':'保存这份存钱安排', stage === 'saved' ? '查看我的存钱计划' : '保存这份储蓄计划'), navigate('wealth', savings.riskStatus==='current'?'比较产品与交易条件':'完成风险评估', 'wealth'), navigate('bills', '查看账单，核对收支', 'bills'));
    if(savings.monthlyCapacityCents>0 && !savings.feasible){
      const possible=(input.mode==='total'?savings.usableStartingCents:0)+savings.monthlyCapacityCents*savings.months;
      facts.push({label:'按当前预算到期可达',value:money(possible),source:'只计明确本金和月预算，收益按0；不是已存金额'});
      actions.push(send('adjust-target',`把目标调为${money(possible)}`,`目标改成${(possible/100).toFixed(2)}元`));
      const needed=Math.ceil(savings.gapCents/savings.monthlyCapacityCents);
      if(needed<=120){const month=shift(input.startMonth,needed-1);const [y,m]=month.split('-').map(Number);const date=`${month}-${new Date(Date.UTC(y,m,0)).getUTCDate()}`;
        actions.push(send('extend',`仍攒${money(input.targetCents)}，延至${month}`,`完成期限改为${date}`));}
    }
    if(savings.feasible && savings.monthlyRequiredCents>0 && savings.monthlyRequiredCents<=state.account.balanceCents-state.account.reservedCents)actions.push(send('reserve','核对一次资金预留方案',`为储蓄目标预留${(savings.monthlyRequiredCents/100).toFixed(2)}元`));
  }
  actions.push(send('cancel', '结束这轮修改', '取消这次储蓄规划'));
  return { kind: 'savings', stage, title, summary, facts, questions: missing.slice(0, 2).map(m => m[1]), clarifications, actions, savings,
    steps: [{ label: '理解目标', status: input.targetCents ? 'done' : 'current' },
      { label: input.mode==='additional'?'核对月度收支':'核对本金与收支', status: missing.length ? 'current' : 'done' },
      { label: '计算月度安排', status: missing.length ? 'pending' : 'done' },
      { label: '保存与后续办理', status: stage === 'saved' ? 'done' : 'pending' }] };
}

export function savingsTurn(state, rawText, slots = {}) {
  const text = String(rawText).trim();
  const data = ensure(state);
  const done = agent => ({ reply: [agent.summary, ...(agent.clarifications?.length ? [] : agent.questions)].join('\n'), agent, trace: ['储蓄规划仅更新本用户规划草稿，不修改资金或金融授权'], sources: { asOf: state.now, productIds: state.products.map(p => p.id), transactionIds: data.draft?.ledgerProposal?.transactionIds ?? [] } });
  if (unsafe(text)) return done({ kind: 'savings', stage: 'cancelled', title: '请求未执行', summary: '不能绕过确认、权限或安全验证。', steps: [], facts: [], questions: [], actions: [] });
  if ((/^(?:取消|算了|停止|不用了)(?:这次|本次|这份)?(?:储蓄|存钱)?(?:规划|计划)?[吧了。！!\s]*$/.test(text) || /^(?:先不存了|不想(?:存钱|攒钱)了|暂时不做这个)[。！!\s]*$/.test(text)) && !/取消.*(?:储蓄|存钱)计划/.test(text)) {
    if (data.draft) data.draft.active = false;
    return done({ kind: 'savings', stage: 'cancelled', title: '已结束本次规划', summary: '本次追问已结束；已保存的目标仍保留，没有改动资金、预约或委托。', steps: [], facts: [], questions: [], actions: [send('list', '查看已保存目标', '查看我的存钱计划')] });
  }
  if (/(?:查看|看看|列出|我的).{0,6}(?:存钱|储蓄)计划/.test(text) && !/目标|修改|改成/.test(text)) {
    const saved = data.savedPlans.filter(p => p.status !== 'cancelled');
    if (!saved.length) return done({ kind: 'savings', stage: 'clarifying', title: '还没有保存的存钱计划', summary: '可以先告诉我希望攒多少、什么时候完成。', steps: [], facts: [], questions: [], actions: [send('new', '开始规划', '帮我做一份存钱计划')] });
    const selected = saved.length === 1 ? saved[0] : saved.find(p => text.includes(p.id));
    if (!selected) return done({ kind: 'savings', stage: 'saved', title: '选择要查看的存钱计划', summary: `你有${saved.length}份已保存目标。`, steps: [], facts: [], questions: [], actions: saved.map(p => send(p.id, `${money(p.input.targetCents)} · ${p.input.deadline}`, `查看储蓄计划${p.id}`)) });
    data.draft = { ...structuredClone(selected), active: true };
    return done(makeView(state, data.draft, 'saved'));
  }
  if (/取消(?:这份|我的|已保存|保存的)?(?:储蓄|存钱)计划/.test(text)) {
    const active = data.savedPlans.filter(p => p.status !== 'cancelled');
    const selected = active.find(p => text.includes(p.id)) ?? (active.length === 1 ? active[0] : null);
    if (active.length > 1 && !selected) return done({ kind: 'savings', stage: 'clarifying', title: '选择要取消的目标', summary: '有多份已保存计划，请明确选择；当前没有取消任何一份。', steps: [], facts: [], questions: [], actions: active.map(p => send(p.id, `取消${money(p.input.targetCents)}目标`, `取消储蓄计划${p.id}`)) });
    if (selected) selected.status = 'cancelled';
    if (data.draft) data.draft.active = false;
    return done({ kind: 'savings', stage: 'cancelled', title: selected ? '已取消所选目标' : '未找到已保存目标', summary: '这里只变更储蓄目标记录，不释放资金，不取消金融预约或委托。', steps: [], facts: [], questions: [], actions: [] });
  }
  if (!data.draft || /另(?:一|个)|新建|重新开始|新(?:的|一份).{0,4}(?:存钱|储蓄|攒钱)(?:计划|规划|目标)/.test(text) || (!data.draft.active && !/(?:修改|改成|改为|调整|保存)/.test(text))) data.draft = { input: {}, sources: {}, active: true };
  const draft = data.draft;
  draft.active = true;
  const parsed = readInput(text, state, draft);
  const rate=/假设年化\s*(-?\d+(?:\.\d{1,2})?)\s*[%％]/.exec(text);
  if(/假设年化/.test(text)){
    const bps=rate?Math.round(Number(rate[1])*100):NaN;
    if(!Number.isInteger(bps)||bps < -2000||bps > 2000||(text.match(/[%％]/g)??[]).length!==1)return done(makeView(state,draft,'clarifying','请只填写一个-20%至20%之间的年化情景，最多两位小数。这是假设，不是产品收益。'));
    if(riskStatus(state)!=='current')return done(makeView(state,draft,'clarifying','请先完成有效的风险问卷，再返回目标比较产品和收益情景。'));
    parsed.input.annualScenarioBps=bps;
    parsed.sources.annualScenarioBps=`用户明确输入“${rate[0]}”，并非产品报价`;
  }
  if (parsed.errors.length) return done(makeView(state, draft, 'clarifying', parsed.errors.join(' ')));
  // The model can interpret a free-form role, but every value needs an exact
  // source span and one matching amount. It cannot overwrite deterministic data.
  const roles={targetCents:/目标|攒|存到|存下|存够|积累/,startingCents:/存款|本金|积蓄|手头|手里|卡里|现在有/,
    emergencyCents:/应急|急用|救急|紧急/,monthlyIncomeCents:/收入|工资|月入|月薪|到手|税后/,
    monthlyExpenseCents:/支出|开销|花销|生活费|花费|房租|租房/};
  for(const key of fiscalKeys){
    const span=slots.evidence?.[key],value=slots[key];
    if(own(parsed.input,key)||typeof span!=='string'||span.length>300||!text.includes(span)||!roles[key].test(span)||!Number.isSafeInteger(value)||value<0||value>100_000_000_000||(key==='targetCents'&&value===0))continue;
    const amounts=span.match(new RegExp(number,'g'))??[];
    if(amounts.length!==1||parseAmount(amounts[0])!==value)continue;
    parsed.input[key]=value;parsed.sources[key]=`用户原文“${span}”（模型识别，金额已核对）`;
  }
  if (/确认采用(?:账单)?粗估/.test(text) && draft.ledgerProposal) {
    parsed.input.monthlyIncomeCents = draft.ledgerProposal.monthlyIncomeCents;
    parsed.input.monthlyExpenseCents = draft.ledgerProposal.monthlyExpenseCents;
    parsed.sources.monthlyIncomeCents = parsed.sources.monthlyExpenseCents = `用户确认的${draft.ledgerProposal.months.join('、')}账单粗估`;
  }
  const next = { ...draft.input, ...parsed.input };
  const today = day(state.now);
  if (next.deadline && (!/^20\d{2}-\d{2}-\d{2}$/.test(next.deadline) || !Number.isFinite(Date.parse(next.deadline)) || new Date(next.deadline + 'T00:00:00Z').toISOString().slice(0, 10) !== next.deadline || next.deadline < today)) return done(makeView(state, draft, 'clarifying', `期限需为不早于模拟环境今天${today}的有效日期，请重新输入。`));
  if (next.startMonth && (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(next.startMonth) || next.startMonth < today.slice(0, 7) || (next.deadline && next.startMonth > next.deadline.slice(0, 7)) || (next.deadline && shift(next.startMonth, 119) < next.deadline.slice(0, 7)))) return done(makeView(state, draft, 'clarifying', '起始月份需在本月或以后、不晚于截止月，规划期限最长120个月。请调整起始月份或完成日期。'));
  Object.assign(draft.input, parsed.input);
  Object.assign(draft.sources, parsed.sources);
  if (/(?:不要|不做|不考虑|先不)(?:理财|投资)/.test(text)) draft.excludeProducts = true;
  else if (/(?:结合|考虑|包含)(?:理财|投资)/.test(text)) draft.excludeProducts = false;
  if (/按账单|用账单|根据账单/.test(text) && /估算|预算|收入|支出/.test(text)) {
    const estimate = ledgerEstimate(state);
    if (!estimate) return done(makeView(state, draft, 'clarifying', '最近三个完整月缺少可识别收入记录，暂不足以估算稳定月预算，请直接补充月收入和必要支出。'));
    draft.ledgerProposal = estimate;
    const agent = makeView(state, draft);
    agent.summary = `最近三个完整月（${estimate.months.join('、')}）共${estimate.count}笔合成流水，粗估月收入${money(estimate.monthlyIncomeCents)}、月支出${money(estimate.monthlyExpenseCents)}。包含房租等转账，可能遗漏其它账户，也可能含一次性消费；请核对后决定是否采用。`;
    agent.questions = ['确认采用这组粗估作为月预算吗？你也可以直接输入更准确的月收入和支出。'];
    agent.clarifications = [];
    agent.actions = [send('accept-ledger', '确认采用粗估', '确认采用账单粗估'), navigate('bills', '核对账单', 'bills')];
    return done(agent);
  }
  let agent = makeView(state, draft);
  if (draft.excludeProducts && agent.savings) agent.savings.products = [];
  if (/(?:保存|确认保存)(?:这份|本次|我的|这次)?(?:储蓄|存钱)?计划|保存这份/.test(text)) {
    if (!agent.savings) return done(makeView(state, draft, 'clarifying', '还缺少必要信息，请补齐后再保存；目前没有创建任何自动存款安排。'));
    const fingerprint = createHash('sha256').update(JSON.stringify({input:draft.input,excludeProducts:!!draft.excludeProducts})).digest('hex');
    let stored = data.savedPlans.find(p => p.fingerprint === fingerprint && p.status !== 'cancelled');
    if(!stored && draft.id){
      stored=data.savedPlans.find(p=>p.id===draft.id && p.status!=='cancelled');
      if(stored)Object.assign(stored,{input:structuredClone(draft.input),sources:structuredClone(draft.sources),excludeProducts:!!draft.excludeProducts,fingerprint,updatedAt:new Date().toISOString()});
    }
    if (!stored) {
      if (data.savedPlans.filter(p => p.status !== 'cancelled').length >= 10) return done(makeView(state, draft, 'ready', '最多保留10份有效储蓄目标，请先取消不再需要的目标。'));
      stored = { id: randomUUID(), input: structuredClone(draft.input), sources: structuredClone(draft.sources), excludeProducts:!!draft.excludeProducts, fingerprint, createdAt: new Date().toISOString(), status: 'saved' };
      data.savedPlans.push(stored);
    }
    draft.id = stored.id;
    agent = makeView(state, draft, 'saved');
    agent.summary = `已保存这份储蓄目标。${agent.summary}这不是自动扣款授权；想预留或购买时会另给办理方案。`;
  }
  return done(agent);
}
