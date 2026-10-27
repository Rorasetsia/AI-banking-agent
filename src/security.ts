import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { request } from './api';

export interface SecurityDevice {
  id: string;
  name: string;
  createdAt: string;
  rpId: string;
}

export interface SecurityStatus {
  passwordConfigured: boolean;
  lockedUntil: number;
  operationCodeConfigured?: boolean;
  operationLockedUntil?: number;
  devices: SecurityDevice[];
  note: string;
}

export interface ProofPair {
  proof: string;
  secondProof: string;
}

export type RegistrationOptionsJSON = Parameters<typeof startRegistration>[0]['optionsJSON'];
export type RegistrationAttestation = Awaited<ReturnType<typeof startRegistration>>;
export type AuthenticationOptionsJSON = Parameters<typeof startAuthentication>[0]['optionsJSON'];
export type AuthenticationAssertion = Awaited<ReturnType<typeof startAuthentication>>;

export type SecurityErrorCode =
  | 'DEVICE_UNSUPPORTED'
  | 'DEVICE_CANCELLED'
  | 'DEVICE_FAILED'
  | 'PASSWORD_REQUIRED'
  | 'INVALID_INPUT';

export class SecurityError extends Error {
  readonly code: SecurityErrorCode;
  readonly details?: unknown;

  constructor(message: string, code: SecurityErrorCode, details?: unknown) {
    super(message);
    this.name = 'SecurityError';
    this.code = code;
    this.details = details;
  }
}

export type DeviceEnvironmentLevel = 'ready' | 'insecure-host' | 'unsupported-browser' | 'no-window';

export interface DeviceEnvironment {
  supported: boolean;
  host: string;
  level: DeviceEnvironmentLevel;
  message: string;
  hint?: string;
}

const LOCALHOST_HINT =
  '请改用 http://localhost:端口 打开。127.0.0.1 与 localhost 属于不同的账户与设备绑定范围，系统不会自动迁移账户或设备，需要在新地址重新绑定设备。';

export function deviceEnvironment(): DeviceEnvironment {
  if (typeof window === 'undefined') {
    return {
      supported: false,
      host: '',
      level: 'no-window',
      message: '当前运行环境没有浏览器窗口，无法执行设备验证，交易已阻断。',
    };
  }

  const host = window.location.hostname;

  if (host === '127.0.0.1' || host === '::1' || host === '[::1]') {
    return {
      supported: false,
      host,
      level: 'insecure-host',
      message: '在 127.0.0.1 下无法完成已绑定设备的验证，本次操作已阻断。',
      hint: LOCALHOST_HINT,
    };
  }

  if (!browserSupportsWebAuthn()) {
    return {
      supported: false,
      host,
      level: 'unsupported-browser',
      message: '此浏览器或当前页面不支持 WebAuthn 设备验证，本次操作已阻断。',
      hint: '请使用支持 WebAuthn 的现代浏览器通过 http://localhost:端口 访问；不支持时会明确阻断，不会降级为仅密码核验。',
    };
  }

  return {
    supported: true,
    host,
    level: 'ready',
    message: `设备验证由浏览器 WebAuthn 完成（${host}），不采集指纹等生物特征；按设备设置可能使用 PIN 或系统解锁。`,
  };
}

export function formatTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '—';
  return new Date(timestamp).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function passwordIssue(password: string): string | null {
  if (password.length < 8 || password.length > 64) return '交易密码需为 8–64 个字符。';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return '交易密码需同时包含字母和数字。';
  return null;
}

export const securityApi = {
  status: () => request<SecurityStatus>('/security'),

  setPassword: (password: string, oldPassword?: string) =>
    request<SecurityStatus>(
      '/security/password',
      oldPassword === undefined || oldPassword === '' ? { password } : { password, oldPassword },
    ),

  registrationOptions: (password: string) =>
    request<RegistrationOptionsJSON>('/security/devices/options', { password }),

  registerDevice: (attestation: RegistrationAttestation, name: string) =>
    request<{ status: string }>('/security/devices/register', { response: attestation, name }),

  removeDevice: (deviceId: string, password: string) =>
    request<{ status: string }>('/security/devices/remove', { deviceId, password }),

  passwordProof: (planId: string, password: string, riskAcknowledged: boolean) =>
    request<{ proof: string; expiresAt: number }>('/security/password-proof', {
      planId,
      password,
      riskAcknowledged,
    }),

  deviceOptions: (planId: string, riskAcknowledged: boolean) =>
    request<AuthenticationOptionsJSON>('/security/device-options', { planId, riskAcknowledged }),

  deviceProof: (planId: string, assertion: AuthenticationAssertion) =>
    request<{ proof: string; expiresAt: number }>('/security/device-proof', {
      planId,
      response: assertion,
    }),
};

function asSecurityError(error: unknown, fallback: string): SecurityError {
  if (error instanceof SecurityError) return error;

  const name = error instanceof Error ? error.name : '';

  switch (name) {
    case 'NotAllowedError':
      return new SecurityError('设备验证已取消或超时，本次交易未执行，系统不会自动重试。', 'DEVICE_CANCELLED', error);
    case 'AbortError':
      return new SecurityError('设备验证被中断，本次交易未执行。', 'DEVICE_CANCELLED', error);
    case 'InvalidStateError':
      return new SecurityError('该设备已在此账户下绑定过，请在设备列表中核对，或改用其他设备。', 'DEVICE_FAILED', error);
    case 'NotSupportedError':
      return new SecurityError('此设备或浏览器不支持所需的验证方式，本次交易已阻断。', 'DEVICE_UNSUPPORTED', error);
    case 'SecurityError':
      return new SecurityError('页面域名与设备绑定不匹配（请使用 localhost 访问），本次交易已阻断。', 'DEVICE_UNSUPPORTED', error);
    default:
      return new SecurityError(fallback, 'DEVICE_FAILED', error);
  }
}

export interface BindDeviceInput {
  name: string;
  password: string;
}

export async function bindDevice(input: BindDeviceInput): Promise<void> {
  const name = input.name.trim();
  if (name.length === 0) throw new SecurityError('请填写用于识别的设备名称。', 'INVALID_INPUT');
  if (input.password.length === 0) throw new SecurityError('绑定设备需要输入交易密码。', 'PASSWORD_REQUIRED');

  const environment = deviceEnvironment();
  if (!environment.supported) {
    throw new SecurityError(
      environment.hint ? `${environment.message}${environment.hint}` : environment.message,
      'DEVICE_UNSUPPORTED',
    );
  }

  const optionsJSON = await securityApi.registrationOptions(input.password);

  let attestation: RegistrationAttestation;
  try {
    attestation = await startRegistration({ optionsJSON });
  } catch (error) {
    throw asSecurityError(error, '设备注册未完成，请重新尝试绑定。');
  }

  await securityApi.registerDevice(attestation, name);
}

export async function verifyTransaction(
  planId: string,
  password: string,
  riskAcknowledged: boolean,
): Promise<ProofPair> {
  if (planId.length === 0) throw new SecurityError('缺少计划标识，无法完成核验。', 'INVALID_INPUT');
  if (password.length === 0) throw new SecurityError('请输入交易密码。', 'PASSWORD_REQUIRED');

  const environment = deviceEnvironment();
  if (!environment.supported) {
    throw new SecurityError(
      environment.hint ? `${environment.message}${environment.hint}` : environment.message,
      'DEVICE_UNSUPPORTED',
    );
  }

  const passwordResult = await securityApi.passwordProof(planId, password, riskAcknowledged);

  const optionsJSON = await securityApi.deviceOptions(planId, riskAcknowledged);

  let assertion: AuthenticationAssertion;
  try {
    assertion = await startAuthentication({ optionsJSON });
  } catch (error) {
    throw asSecurityError(error, '设备验证未完成，本次交易未执行。');
  }

  const deviceResult = await securityApi.deviceProof(planId, assertion);

  return { proof: passwordResult.proof, secondProof: deviceResult.proof };
}
