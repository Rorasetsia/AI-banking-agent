import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { request } from './api';
import {policyPermission,evaluateDeviceEnvironment,deviceFailureMessage} from './security-environment';
import type {DevicePurpose,PolicyDocument} from './security-environment';

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

export type DeviceEnvironmentLevel = 'ready' | 'insecure-host' | 'unsupported-browser' | 'no-window' | 'blocked-by-page';
export interface DeviceEnvironment {supported:boolean;host:string;level:DeviceEnvironmentLevel;message:string;hint?:string}
export function deviceEnvironment(purpose:DevicePurpose='authenticate'):DeviceEnvironment {
 if(typeof window==='undefined')return {supported:false,host:'',level:'no-window',message:'当前没有可用的浏览器窗口，暂时不能进行设备验证。'};
 const permission=policyPermission(document as unknown as PolicyDocument,purpose==='register'?'publickey-credentials-create':'publickey-credentials-get');
 return evaluateDeviceEnvironment({host:window.location.hostname,secure:window.isSecureContext,browserSupported:browserSupportsWebAuthn(),permission,purpose});
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

function asSecurityError(error: unknown, fallback: string, purpose:DevicePurpose='authenticate'): SecurityError {
 if(error instanceof SecurityError)return error;
 const result=deviceFailureMessage(error instanceof Error?error.name:'',purpose,fallback);
 return new SecurityError(result.message,result.code,error);
}

export interface BindDeviceInput {
  name: string;
  password: string;
}

export async function bindDevice(input: BindDeviceInput): Promise<void> {
  const name = input.name.trim();
  if (name.length === 0) throw new SecurityError('请填写用于识别的设备名称。', 'INVALID_INPUT');
  if (input.password.length === 0) throw new SecurityError('绑定设备需要输入交易密码。', 'PASSWORD_REQUIRED');

  const environment = deviceEnvironment('register');
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
    throw asSecurityError(error, '设备验证还没设置完成，请检查系统提示后再试。', 'register');
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
