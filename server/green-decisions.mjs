/**
 * 绿色决策计算模块：通勤费用对比与家电更换评估。
 * 纯函数、无网络请求；费用由用户输入，排放按有出处的深圳2026年因子估算。
 */

import { applianceCarbon, commuteCarbon } from './green-carbon.mjs';
const ERROR_CODE = 'INVALID_GREEN_DECISION';
const ERROR_STATUS = 400;
const MAX_MONEY_CENTS = 100000000;
const MAX_ENERGY_KWH = 100000;
const money=value=>`¥${(value/100).toFixed(2)}`;

const COMMUTE_REQUIRED_KEYS = ['originalDailyCents', 'alternativeDailyCents', 'days', 'extraMinutes'];
const COMMUTE_ALLOWED_KEYS = [...COMMUTE_REQUIRED_KEYS, 'maxExtraMinutes','dailyKm','originalMode','alternativeMode','originalMinutes','alternativeMinutes'];

const APPLIANCE_REQUIRED_KEYS = [
  'currentAnnualKwh',
  'electricityPriceCents',
  'years',
  'replacementRequired',
  'candidates'
];
const APPLIANCE_ALLOWED_KEYS = [...APPLIANCE_REQUIRED_KEYS, 'budgetCents'];
const CANDIDATE_KEYS = ['name', 'priceCents', 'annualKwh'];

function invalid(message) {
  const error = new Error(message);
  error.code = ERROR_CODE;
  error.status = ERROR_STATUS;
  return error;
}

function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid(`${label}必须是普通对象`);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw invalid(`${label}必须是普通对象`);
  }
  return value;
}

function assertKnownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw invalid(`${label}包含未知字段：${key}`);
    }
  }
}

function assertRequiredKeys(value, required, label) {
  for (const key of required) {
    if (value[key] === undefined) {
      throw invalid(`${label}缺少必填字段：${key}`);
    }
  }
}

function assertMoneyCents(value, label, min = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalid(`${label}必须是有限的整数分`);
  }
  if (!Number.isInteger(value)) {
    throw invalid(`${label}必须是整数分`);
  }
  if (value < min) {
    throw invalid(min > 0 ? `${label}必须大于 0 分` : `${label}不能为负数`);
  }
  if (value > MAX_MONEY_CENTS) {
    throw invalid(`${label}不能超过 ${MAX_MONEY_CENTS} 分`);
  }
  return value;
}

function assertEnergyKwh(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalid(`${label}必须是有限的千瓦时数值`);
  }
  if (value < 0 || value > MAX_ENERGY_KWH) {
    throw invalid(`${label}必须在 0 到 ${MAX_ENERGY_KWH} 千瓦时之间`);
  }
  const text = String(value);
  const dot = text.indexOf('.');
  if (text.includes('e') || text.includes('E') || (dot !== -1 && text.length - dot - 1 > 2)) {
    throw invalid(`${label}最多保留两位小数`);
  }
  return value;
}

function assertIntegerInRange(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw invalid(`${label}必须是 ${min} 到 ${max} 之间的整数`);
  }
  if (value < min || value > max) {
    throw invalid(`${label}必须在 ${min} 到 ${max} 之间`);
  }
  return value;
}

function assertBoolean(value, label) {
  if (typeof value !== 'boolean') {
    throw invalid(`${label}必须是 true 或 false`);
  }
  return value;
}

function assertName(value, label) {
  if (typeof value !== 'string') {
    throw invalid(`${label}必须是字符串`);
  }
  const name = value.trim();
  if (name.length < 1 || name.length > 30) {
    throw invalid(`${label}去除空格后长度必须在 1 到 30 个字符之间`);
  }
  return name;
}

/**
 * 通勤方案费用对比。
 * @param {{originalDailyCents:number, alternativeDailyCents:number, days:number, extraMinutes:number, maxExtraMinutes?:number}} input
 */
export function calculateCommute(input) {
  assertPlainObject(input, '通勤输入');
  assertKnownKeys(input, COMMUTE_ALLOWED_KEYS, '通勤输入');
  assertRequiredKeys(input, COMMUTE_REQUIRED_KEYS, '通勤输入');

  const originalDailyCents = assertMoneyCents(input.originalDailyCents, '原方案每日费用');
  const alternativeDailyCents = assertMoneyCents(input.alternativeDailyCents, '新方案每日费用');
  const days = assertIntegerInRange(input.days, 1, 31, '通勤天数');
  const legacyExtra = assertIntegerInRange(input.extraMinutes, 0, 240, '每日多花时间');
  const hasTimes = input.originalMinutes !== undefined || input.alternativeMinutes !== undefined;
  const originalMinutes = hasTimes ? assertIntegerInRange(input.originalMinutes,0,240,'原方案每天耗时') : null;
  const alternativeMinutes = hasTimes ? assertIntegerInRange(input.alternativeMinutes,0,240,'新方案每天耗时') : null;
  const extraMinutes = hasTimes ? alternativeMinutes - originalMinutes : legacyExtra;
  const carbon = commuteCarbon(input);
  const hasMax = input.maxExtraMinutes !== undefined;
  const maxExtraMinutes = hasMax
    ? assertIntegerInRange(input.maxExtraMinutes, 0, 240, '每日可接受的额外时间上限')
    : null;

  const originalTotalCents = originalDailyCents * days;
  const alternativeTotalCents = alternativeDailyCents * days;
  const differenceCents = originalTotalCents - alternativeTotalCents;
  const extraTotalMinutes = extraMinutes * days;
  const fitsTime = hasMax ? extraMinutes <= maxExtraMinutes : true;

  const gap = Math.abs(differenceCents);
  let conclusion;
  if (differenceCents > 0) {
    conclusion = `按 ${days} 个可替代日估算，新方案支出 ${money(alternativeTotalCents)}，比原方案少 ${money(gap)}。`;
  } else if (differenceCents < 0) {
    conclusion = `按 ${days} 个可替代日估算，新方案支出 ${money(alternativeTotalCents)}，比原方案多 ${money(gap)}。`;
  } else {
    conclusion = `按 ${days} 个可替代日估算，两种方案支出相同，均为 ${money(originalTotalCents)}。`;
  }
  if (!fitsTime) {
    conclusion += `每日多花 ${extraMinutes} 分钟，超出你设定的 ${maxExtraMinutes} 分钟上限。`;
  } else if (extraMinutes < 0) {
    conclusion += `每天少花 ${-extraMinutes} 分钟。`;
  } else if (hasMax) {
    conclusion += `每日多花 ${extraMinutes} 分钟，在你设定的 ${maxExtraMinutes} 分钟上限内。`;
  }

  return {
    kind: 'commute',
    originalTotalCents,
    alternativeTotalCents,
    differenceCents,
    extraTotalMinutes,
    originalTotalMinutes:hasTimes?originalMinutes*days:null,
    alternativeTotalMinutes:hasTimes?alternativeMinutes*days:null,
    carbon,
    fitsTime,
    conclusion,
    assumptions: [
      `只按你选择的 ${days} 天估算，未考虑节假日、请假或临时改道。`,
      '费用和耗时由你填写；排放依据距离、方式与深圳2026年因子估算，不是实测减排或碳积分。',
      '费用差额只是支出对比，不等于实际收入或可提现收益。',
      '原、新方案均按每日往返距离比较；耗时请自行计入换乘等待。'
    ]
  };
}

/**
 * 家电更换评估。
 * @param {{currentAnnualKwh:number, electricityPriceCents:number, years:number, replacementRequired:boolean, budgetCents?:number, candidates:Array<{name:string, priceCents:number, annualKwh:number}>}} input
 */
export function evaluateAppliance(input) {
  assertPlainObject(input, '家电评估输入');
  assertKnownKeys(input, APPLIANCE_ALLOWED_KEYS, '家电评估输入');
  assertRequiredKeys(input, APPLIANCE_REQUIRED_KEYS, '家电评估输入');

  const currentAnnualKwh = assertEnergyKwh(input.currentAnnualKwh, '现有设备年耗电量');
  const electricityPriceCents = assertEnergyKwh(input.electricityPriceCents, '电价（分/千瓦时）');
  if(electricityPriceCents<1||electricityPriceCents>1000)throw invalid('电价需在0.01—10元/千瓦时之间，最多四位小数。');
  const years = assertIntegerInRange(input.years, 1, 15, '使用年限');
  const replacementRequired = assertBoolean(input.replacementRequired, '是否必须更换');
  const hasBudget = input.budgetCents !== undefined;
  const budgetCents = hasBudget ? assertMoneyCents(input.budgetCents, '预算', 1) : null;

  const rawCandidates = input.candidates;
  if (!Array.isArray(rawCandidates)) {
    throw invalid('候选机型必须是数组');
  }
  if (rawCandidates.length < 1 || rawCandidates.length > 2) {
    throw invalid('候选机型数量必须是 1 到 2 个');
  }

  const candidates = rawCandidates.map((raw, index) => {
    const label = `候选机型第 ${index + 1} 项`;
    assertPlainObject(raw, label);
    assertKnownKeys(raw, CANDIDATE_KEYS, label);
    assertRequiredKeys(raw, CANDIDATE_KEYS, label);
    return {
      name: assertName(raw.name, `${label}名称`),
      priceCents: assertMoneyCents(raw.priceCents, `${label}价格`, 1),
      annualKwh: assertEnergyKwh(raw.annualKwh, `${label}年耗电量`)
    };
  });

  const keepAnnualCostCents = Math.round(currentAnnualKwh * electricityPriceCents);
  const keepTotalCostCents = keepAnnualCostCents * years;

  const options = candidates.map((candidate) => {
    const annualCostCents = Math.round(candidate.annualKwh * electricityPriceCents);
    const totalCostCents = candidate.priceCents + annualCostCents * years;
    const annualSavingCents = keepAnnualCostCents - annualCostCents;
    const paybackYears = annualSavingCents > 0
      ? Math.round((candidate.priceCents / annualSavingCents) * 10) / 10
      : null;
    const withinBudget = hasBudget ? candidate.priceCents <= budgetCents : true;
    return {
      name: candidate.name,
      priceCents: candidate.priceCents,
      annualKwh: candidate.annualKwh,
      annualCostCents,
      totalCostCents,
      annualSavingCents,
      paybackYears,
      withinBudget
    };
  });

  // 打平时保留现有设备：只有严格更便宜才替换。
  let best = replacementRequired
    ? null
    : { kind: 'keep', index: null, totalCostCents: keepTotalCostCents };
  options.forEach((option, index) => {
    if (!option.withinBudget) return;
    if (best === null || option.totalCostCents < best.totalCostCents) {
      best = { kind: 'replace', index, totalCostCents: option.totalCostCents };
    }
  });

  const recommendation = best === null ? 'no_fit' : best.kind;
  const recommendedIndex = recommendation === 'replace' ? best.index : null;

  let conclusion;
  if (recommendation === 'keep') {
    conclusion = `先继续用旧机：按你提供的条件，${years}年电费约${money(keepTotalCostCents)}，换新暂不带来更低总支出。`;
  } else if (recommendation === 'replace') {
    const chosen = options[best.index];
    const paybackText = chosen.paybackYears === null
      ? '电费没有低于旧机参考值'
      : `每年电费比旧机参考值少约${money(chosen.annualSavingCents)}`;
    conclusion = `在已提供的方案中，「${chosen.name}」${years}年总支出较低，约${money(chosen.totalCostCents)}；${paybackText}。`;
  } else {
    conclusion = hasBudget
      ? `已提供的报价都超出${money(budgetCents)}购机预算，可先寻找符合预算的方案。`
      : '没有符合条件的替换机型，暂不推荐更换。';
  }

  const assumptions = [
    '年电费按“年耗电量 × 电价”四舍五入到分，未考虑阶梯电价、峰谷差异或电价变化。',
    '保留现有设备视为没有购机成本，只计算其用电成本。',
    '未计算补贴、维修、转卖或分期付款，也不含安装与拆旧费用。',
    '用电排放按深圳2026年因子估算；未计新机制造与旧机报废，不代表换新的全生命周期净减排。'
  ];
  if (hasBudget) {
    assumptions.push('预算只用于筛选购机价格，不限制后续电费支出。');
  }

  return {
    kind: 'appliance',
    years,
    keep: { annualCostCents: keepAnnualCostCents, totalCostCents: keepTotalCostCents },
    options,
    carbon:applianceCarbon(currentAnnualKwh,candidates,years),
    recommendation,
    recommendedIndex,
    conclusion,
    assumptions
  };
}
