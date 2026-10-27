import type { AgentView } from './agent-types';
export type IntentMode = 'rule' | 'llm';
export interface CategorySummary {name: string; amountCents: number; count: number}
export interface Transaction { id: string; amountCents: number; merchant: string; category: string; date: string; memo: string; kind: string }
export interface Contact { id: string; name: string; phone: string; note: string }
export interface Product { id: string; name: string; code?: string; manager?: string; category?: string; officialUrl?: string; riskLevel: number; termDays: number; minCents: number; unitPriceCents: number; description: string }
export interface Card { id: string; name: string; last4: string; type: 'debit' | 'credit'; status: 'active' | 'locked' | 'lost'; limitCents: number; perTxLimitCents: number }
export interface OwnCard { id: string; name: string; last4: string; ownerId: string; balanceCents: number; status: string; perTxLimitCents: number }
export interface OperationRisk { level: string; reasons: {code: string; title: string; detail: string}[]; maxAmountCents: number; thresholdCents: number; checkedAt: string; note: string }
export interface Subscription { id: string; name: string; amountCents: number; cycleDays: number; nextChargeAt: string; status: string; source: string; category: string; evidenceIds?: string[]; detectionReason?: string }
export interface Receipt { id: string; title: string; executedAt: string; summary: string; transactionIds: string[]; balanceCents: number; details: unknown[] }
export interface Plan { id: string; nonce: string; status: string; createdAt: string; expiresAt: string; demoExpiresAt?: string; requestText?: string; title: string; summary: string; steps: {tool: string; params: Record<string, unknown>; label: string}[]; impactCents: number; warnings: string[]; receipt?: Receipt; operationRisk?: OperationRisk }
export interface Schedule { id: string; type: string; title: string; executeAt: string; status: string; params: Record<string, unknown>; authorizedByPlanId?: string; authorizationReceiptId?: string; error?: string; receipt?: Receipt }
export interface Recovery { title: string; draft?: string; actions: {label: string; kind: 'navigate'|'edit'|'refresh'; route?: Route}[] }
export interface Message { id: string; role: 'user' | 'assistant'; text: string; at: string; intentSource?: string; fallbackReason?: string; planId?: string; recovery?: Recovery; sources?: Record<string, unknown>; trace?: unknown[]; agent?: AgentView }
export interface Analysis { period: string; title: string; incomeCents: number; expenseCents: number; netCents: number; investmentInflowCents: number; investmentOutflowCents: number; consumptionCents: number; consumptionCategories?: CategorySummary[]; scopeNote: string; count: number; categories: {name: string; amountCents: number; count: number}[]; timeline: {label: string; incomeCents: number; expenseCents: number}[]; anomalies: {transactionId: string; title: string; reason: string; amountCents: number}[]; sources: {transactionIds: string[]; asOf: string; filter: Record<string, unknown>} }
export interface BankState {
  savingsAgent?: { draft?: { active: boolean; input: Record<string, unknown> } | null; savedPlans: { id: string; input: { targetCents: number; deadline: string; mode: string }; status: string; createdAt: string }[] };
  green?: {consent:boolean;preferences?:{maxExtraMinutes?:number;requiredCarDays?:number}};
  userId: string; profile: {name: string}; now: string;
  account: {id: string; name: string; balanceCents: number; reservedCents: number};
  contacts: Contact[]; transactions: Transaction[]; products: Product[]; holdings: {productId: string; shares: number}[];
  ownCards?: OwnCard[]; ownFundMovements?: {id: string; transactionId: string; ownCardId: string; amountCents: number; direction: string; date: string}[];
  mandates?: {id: string; title: string; scope: string; status: string; thresholdCents: number; excludedSubscriptionIds: string[]; expiresAt: string; nextRunAt: string; runs: Record<string, unknown>[]}[];
  disputeCases?: Record<string, unknown>[]; notifications?: {id: string; title: string; message?: string; body?: string; at?: string; createdAt?: string; [key: string]: unknown}[];
  subscriptions: Subscription[]; cards: Card[]; risk: null | {level: number; score: number; assessedAt: string; maxScore?: number; questionnaireVersion?: number; knowledgeCorrect?: number; knowledgeTotal?: number; summary?: string[]};
  plans: Plan[]; schedules: Schedule[]; goals: Record<string, unknown>[]; orders?: Record<string, unknown>[];
  audit: {id: string; at: string; action: string; detail: unknown; prevHash: string; hash: string}[];
  messages: Message[]; pending: null | {question: string; candidates?: unknown[]; missing?: string[]; questions?: import('./agent-types').AgentQuestion[]};
  analysis: Analysis;
  cashflow: {availableCents: number; reservedCents: number; upcomingCents: number; projectedCents: number; projectedBalanceCents: number; projectedReservedCents: number; releasedReserveCents: number; assumptions: string[]; items: {id: string; title: string; amountCents: number; date: string; type: string}[]};
}
export interface Session { user: {name: string}; mode: string; llmConfigured: boolean; now: string; persistence?: 'ephemeral' }
export type Route = 'cover'|'overview'|'assistant'|'green'|'bills'|'transfers'|'accounts'|'wealth'|'cards'|'subscriptions'|'tasks'|'funding'|'mandates'|'family'|'security'|'settings';
export interface PageProps {
  state: BankState;
  send: (text: string) => Promise<void>;
  busy: boolean;
  openPlan: (plan: Plan) => void;
  refresh: () => Promise<void>;
  navigate?: (route: Route) => void;
  askAssistant?: (text: string) => void;
  onAccountSettingsChanged?: () => void | Promise<void>;
}
