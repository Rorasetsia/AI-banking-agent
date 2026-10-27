/**
 * 绿色选择工具（/green/decisions/*）的共享类型。
 * 仅描述请求与响应结构，不包含任何金额读写、存储或外部副作用。
 */

export type GreenToolKind = 'appliance' | 'commute';
export type TransportMode = 'urban' | 'electric_bus' | 'metro' | 'walk_cycle';
export interface CarbonSource {title:string;url:string;pdf:string;year:number}
export interface ApplianceCarbon {keepAnnualKg:number;options:{annualKg:number;annualReductionKg:number;totalReductionKg:number}[];factor:number;source:CarbonSource;scope:string}
export interface CommuteCarbon {originalKg:number;alternativeKg:number;reductionKg:number;originalLabel:string;alternativeLabel:string;originalFactor:number;alternativeFactor:number;dailyKm:number;days:number;source:CarbonSource;scope:string}

export interface ApplianceCandidateInput {
  /** 展示名称；界面未填写时使用默认名「新机A」/「新机B」 */
  name: string;
  /** 购机价，单位：分 */
  priceCents: number;
  /** 每年耗电，单位：kWh */
  annualKwh: number;
}

export interface ApplianceInput {
  /** 旧机每年耗电，单位：kWh */
  currentAnnualKwh: number;
  /** 电价，单位：分/kWh */
  electricityPriceCents: number;
  /** 计划使用年数，1–15 的整数 */
  years: number;
  /** 旧机是否已不能继续使用 */
  replacementRequired: boolean;
  /** 预算，单位：分；可选 */
  budgetCents?: number;
  /** 候选新机，最多 2 台 */
  candidates: ApplianceCandidateInput[];
}

export interface CommuteInput {
  dailyKm?:number;
  originalMode?:TransportMode;
  alternativeMode?:TransportMode;
  originalMinutes?:number;
  alternativeMinutes?:number;
  /** 原方案每天花费，单位：分 */
  originalDailyCents: number;
  /** 新方案每天花费，单位：分 */
  alternativeDailyCents: number;
  /** 每月天数，1–31 的整数 */
  days: number;
  /** 每天多花时间，0–240 的整数分钟 */
  extraMinutes: number;
  /** 可接受的最长每天多花时间，可选 */
  maxExtraMinutes?: number;
}

export interface ApplianceKeepResult {
  annualCostCents: number;
  totalCostCents: number;
}

export interface ApplianceOptionResult {
  name: string;
  priceCents: number;
  annualKwh: number;
  annualCostCents: number;
  totalCostCents: number;
  annualSavingCents: number;
  paybackYears: number | null;
  withinBudget: boolean;
}

export type ApplianceRecommendation = 'keep' | 'replace' | 'no_fit';

export interface ApplianceResult {
  carbon:ApplianceCarbon;
  kind: 'appliance';
  years: number;
  keep: ApplianceKeepResult;
  options: ApplianceOptionResult[];
  recommendation: ApplianceRecommendation;
  recommendedIndex: number | null;
  conclusion: string;
  assumptions: string[];
}

export interface CommuteResult {
  carbon:CommuteCarbon|null;
  originalTotalMinutes:number|null;
  alternativeTotalMinutes:number|null;
  kind: 'commute';
  originalTotalCents: number;
  alternativeTotalCents: number;
  /** 正数表示省钱，负数表示多花钱 */
  differenceCents: number;
  extraTotalMinutes: number;
  fitsTime: boolean;
  conclusion: string;
  assumptions: string[];
}

export type GreenDecisionInput = ApplianceInput | CommuteInput;
export type GreenDecisionResult = ApplianceResult | CommuteResult;

/** AI 咨询使用的原始提交内容（不含任何结果或结论） */
export interface GreenDecisionPayload {
  kind: GreenToolKind;
  input: GreenDecisionInput;
}
