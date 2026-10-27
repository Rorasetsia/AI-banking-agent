import type { BankState, Session, IntentMode, Plan, Receipt, Recovery } from './types';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string, public recovery?: Recovery) {
    super(message); this.name = 'ApiError';
  }
}

export async function request<T>(path: string, data?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: data === undefined ? undefined : {'Content-Type': 'application/json'},
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  } catch {
    throw new ApiError(
      '暂时连接不到银行模拟环境。请检查网络；免费试用站首次唤醒可能需要稍等片刻，之后刷新重试。',
      0,
      'NETWORK_UNAVAILABLE',
    );
  }
  let result;
  try { result = await response.json(); }
  catch { throw new ApiError('服务响应无法读取，请先刷新核对当前状态。', response.status, 'INVALID_RESPONSE'); }
  if (!response.ok) throw new ApiError(result.error?.message ?? '操作失败，请核对后重试', response.status, result.error?.code ?? 'HTTP_ERROR', result.error?.recovery);
  return result;
}
export const api = {
  session: () => request<Session>('/session'),
  state: () => request<BankState>('/state'),
  chat: (text: string, mode: IntentMode) => request<{reply: string; plan?: Plan; intentSource: string}>('/chat', {text, mode}),
  confirm: (plan: Plan, proofs: {proof: string; secondProof: string}) => request<{status: string; receipt: Receipt}>(`/plans/${encodeURIComponent(plan.id)}/confirm`, {nonce: plan.nonce, ...proofs}),
  cancel: (plan: Plan) => request<{status: string}>(`/plans/${encodeURIComponent(plan.id)}/cancel`, {nonce: plan.nonce}),
  risk: (answers: number[]) => request<{risk: BankState['risk']}>('/risk', {answers}),
  tick: (asOf: string) => request<{triggered: unknown[]; now: string}>('/schedules/tick', {asOf}),
  reset: () => request<BankState>('/reset', {}),
};
export interface AccountSettingsStatus {
  displayName: string;
  accountName: string;
  operationCodeConfigured: boolean;
  operationLockedUntil: number;
  transactionPasswordConfigured: boolean;
  note: string;
}
export const accountApi = {
  settings: () => request<AccountSettingsStatus>('/account/settings'),
  setOperationCode: (code: string, currentCode?: string) =>
    request<{ operationCodeConfigured: boolean; operationLockedUntil: number }>(
      '/account/operation-code',
      currentCode ? { code, currentCode } : { code },
    ),
};
export const money = (cents: number) => new Intl.NumberFormat('zh-CN', {style: 'currency', currency: 'CNY', minimumFractionDigits: 2}).format(cents / 100);
export const day = (date: string) => new Date(date).toLocaleDateString('zh-CN', {timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit'});
