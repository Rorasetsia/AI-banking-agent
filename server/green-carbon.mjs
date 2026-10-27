// Shenzhen Ecology and Environment Bureau, 2026 factors, checked 2026-10-26.
// These are scenario estimates, not verified carbon credits or life-cycle totals.
export const CARBON_SOURCE = Object.freeze({
  title: '深圳市2026年碳普惠排放因子',
  url: 'https://www.sz.gov.cn/cn/xxgk/zfxxgj/tzgg/content/post_12721032.html',
  pdf: 'https://meeb.sz.gov.cn/attachment/1/1700/1700728/12721034.pdf',
  year: 2026,
});
export const ELECTRICITY_KG_PER_KWH = 0.4419;
export const TRANSPORT_MODES = Object.freeze({
  urban: {label:'城市出行参考',factor:0.0928},
  electric_bus: {label:'纯电动公交',factor:0.0819},
  metro: {label:'地铁',factor:0.0410},
  walk_cycle: {label:'步行或自行车',factor:0},
});
const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
export function applianceCarbon(currentKwh, candidates, years) {
  return {
    keepAnnualKg:round(currentKwh*ELECTRICITY_KG_PER_KWH),
    options:candidates.map(c=>({
      annualKg:round(c.annualKwh*ELECTRICITY_KG_PER_KWH),
      annualReductionKg:round((currentKwh-c.annualKwh)*ELECTRICITY_KG_PER_KWH),
      totalReductionKg:round((currentKwh-c.annualKwh)*years*ELECTRICITY_KG_PER_KWH),
    })),
    factor:ELECTRICITY_KG_PER_KWH,
    source:CARBON_SOURCE,
    scope:'仅估算使用阶段用电排放，不含设备制造、运输和报废；相同使用需求，因子保持不变。',
  };
}
export function commuteCarbon(input) {
  const keys=['dailyKm','originalMode','alternativeMode'];
  if(!keys.some(k=>input[k]!==undefined))return null;
  const invalid=message=>{const error=new Error(message);error.code='INVALID_GREEN_DECISION';error.status=400;throw error;};
  if(keys.some(k=>input[k]===undefined))invalid('请同时填写每日往返距离、原交通方式和新交通方式。');
  const distance=input.dailyKm;
  if(typeof distance!=='number'||!Number.isFinite(distance)||distance<=0||distance>500||Math.abs(distance*100-Math.round(distance*100))>1e-7)invalid('每日往返距离需大于0且不超过500公里，最多两位小数。');
  if(!Object.hasOwn(TRANSPORT_MODES,input.originalMode)||!Object.hasOwn(TRANSPORT_MODES,input.alternativeMode))invalid('请选择支持的交通方式。');
  const original=TRANSPORT_MODES[input.originalMode],alternative=TRANSPORT_MODES[input.alternativeMode];
  const km=distance*input.days;
  return {
    originalKg:round(km*original.factor),alternativeKg:round(km*alternative.factor),
    reductionKg:round(km*(original.factor-alternative.factor)),
    originalLabel:original.label,alternativeLabel:alternative.label,
    originalFactor:original.factor,alternativeFactor:alternative.factor,
    dailyKm:distance,days:input.days,source:CARBON_SOURCE,
    scope:'按相同往返距离估算使用阶段排放。城市出行参考是统计基准，并非个人驾车实测；步行及自行车直接排放按0计，不含制造等生命周期排放。',
  };
}
