import type { Route } from './types';

export interface AgentAction { id: string; label: string; kind: 'send' | 'navigate'; text?: string; route?: Route }
export interface AgentStep { label: string; status: 'done' | 'current' | 'pending'; detail?: string }
export interface AgentQuestion {
  id: string; label: string; hint?: string;
  visibleWhen?: { questionId: string; optionIds: string[]; fieldId?: string; values?: string[]; not?: boolean }[];
  options?: { id: string; label: string; detail?: string; reply: string }[];
  fields?: { id: string; label: string; type: 'money' | 'date' | 'datetime-local' | 'number' | 'text'; prefix: string; suffix?: string; placeholder?: string; min?: number; max?: number }[];
}
export interface SavingsProjection {
  targetCents: number; mode: 'total' | 'additional'; startingCents: number | null; emergencyCents: number | null;
  usableStartingCents: number; gapCents: number; monthlyRequiredCents: number; monthlyCapacityCents: number | null;
  monthlyIncomeCents?: number | null; monthlyExpenseCents?: number | null;
  monthlyPlannedCents?: number | null; atDeadlineCents?: number | null; shortfallAtDeadlineCents?: number | null;
  budgetSchedule?: {month:string;amountCents:number;cumulativeCents:number}[];
  riskStatus?: 'required' | 'expired' | 'current'; riskLevel?: number | null;
  simulation?: {annualRateBps:number;contributionCents:number;estimatedReturnCents:number;projectedTotalCents:number;shortfallCents:number;targetReached:boolean;assumptions:string[]} | null;
  monthlyGapCents: number | null; deadline: string; startMonth: string; months: number; feasible: boolean | null;
  schedule: { month: string; amountCents: number; cumulativeCents: number }[];
  products: { id: string; name: string; code?: string; riskLevel: number; eligible: boolean; reason: string; officialUrl?: string }[];
  assumptions: string[]; warnings: string[];
}
export interface AgentView {
  kind: 'savings' | 'banking'; stage: 'clarifying' | 'ready' | 'saved' | 'cancelled' | 'awaiting_confirmation' | 'completed';
  title: string; summary: string; steps: AgentStep[]; facts: { label: string; value: string; source: string }[];
  questions: string[]; clarifications?: AgentQuestion[]; actions: AgentAction[]; savings?: SavingsProjection;
}
