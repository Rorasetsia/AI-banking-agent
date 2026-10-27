import {FeatureEntry} from './FeatureEntry';
import { useCallback, useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { money } from '../api';
import type { Plan } from '../types';
import {
  bindDevice,
  deviceEnvironment,
  formatTimestamp,
  passwordIssue,
  securityApi,
  verifyTransaction,
} from '../security';
import type { ProofPair, SecurityStatus } from '../security';

const alertStyle = { color: '#b42318', margin: '8px 0' } as const;
const noticeStyle = { color: '#067647', margin: '8px 0' } as const;
const hintStyle = { fontSize: '0.875rem', margin: '4px 0', opacity: 0.8 } as const;
const metaStyle = { fontSize: '0.8125rem', opacity: 0.75 } as const;
const listStyle = { listStyle: 'none', padding: 0, margin: '0 0 12px', display: 'grid', gap: 8 } as const;
const deviceRowStyle = { border: '1px solid rgba(15, 23, 42, 0.12)', borderRadius: 8, padding: '10px 12px' } as const;
const rowStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  alignItems: 'center',
  justifyContent: 'space-between',
} as const;
const actionRowStyle = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' } as const;

function readErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return fallback;
}

export interface SecurityCenterProps {
  refresh: () => Promise<void>;
}

export function SecurityCenter({ refresh }: SecurityCenterProps) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const passwordHeadingId = `${baseId}-password-heading`;
  const deviceHeadingId = `${baseId}-device-heading`;
  const oldPwId = `${baseId}-old-password`;
  const newPwId = `${baseId}-new-password`;
  const confirmPwId = `${baseId}-confirm-password`;
  const deviceNameId = `${baseId}-device-name`;
  const devicePwId = `${baseId}-device-password`;
  const removePwId = `${baseId}-remove-password`;

  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);

  const [deviceName, setDeviceName] = useState('');
  const [devicePassword, setDevicePassword] = useState('');
  const [deviceBusy, setDeviceBusy] = useState<string | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [deviceNotice, setDeviceNotice] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removePassword, setRemovePassword] = useState('');

  const environment = deviceEnvironment();
  const configured = status?.passwordConfigured === true;
  const lockedUntil = status?.lockedUntil ?? 0;
  const locked = lockedUntil > Date.now();

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const next = await securityApi.status();
      setStatus(next);
      setLoadError(null);
    } catch (error) {
      setLoadError(readErrorMessage(error, '安全状态读取失败，请稍后重试。'));
    } finally {
      setLoading(false);
    }
  }, []);

  const syncStatus = useCallback(async () => {
    try {
      const next = await securityApi.status();
      setStatus(next);
      setLoadError(null);
    } catch (error) {
      setLoadError(readErrorMessage(error, '安全状态刷新失败，请重新读取核对。'));
    }
  }, []);

  const refreshQuietly = useCallback(async () => {
    try {
      await refresh();
    } catch {
      // 主状态刷新失败不影响安全操作结果，用户可稍后手动刷新核对。
    }
  }, [refresh]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingPassword) return;

    setPasswordError(null);
    setPasswordNotice(null);

    if (configured && oldPassword.length === 0) {
      setPasswordError('请输入当前交易密码后再设置新密码。');
      return;
    }

    const issue = passwordIssue(newPassword);
    if (issue) {
      setPasswordError(issue);
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的新密码不一致，请重新输入。');
      return;
    }

    setSavingPassword(true);
    try {
      const next = await securityApi.setPassword(newPassword, configured ? oldPassword : undefined);
      setStatus(next);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordNotice(
        configured
          ? '交易密码已修改，下次核验请使用新密码。'
          : '交易密码已设置，接下来请绑定至少一台设备，否则所有写操作仍会被阻断。',
      );
      await refreshQuietly();
    } catch (error) {
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordError(readErrorMessage(error, '交易密码保存失败，请核对后重试。'));
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleRegisterDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deviceBusy !== null) return;

    setDeviceError(null);
    setDeviceNotice(null);

    if (!environment.supported) {
      setDeviceError(
        environment.hint ? `${environment.message}${environment.hint}` : environment.message,
      );
      return;
    }

    const name = deviceName.trim();
    if (name.length === 0 || name.length > 40) {
      setDeviceError('请填写 1–40 个字符的设备名称，便于之后识别是哪台设备。');
      return;
    }

    if (devicePassword.length === 0) {
      setDeviceError('请输入交易密码，服务端会先校验密码再发起设备验证。');
      return;
    }

    setDeviceBusy('register');
    try {
      await bindDevice({ name, password: devicePassword });
    } catch (error) {
      setDevicePassword('');
      setDeviceError(readErrorMessage(error, '设备绑定未完成，请重试。'));
      setDeviceBusy(null);
      return;
    }

    setDevicePassword('');
    setDeviceName('');
    setDeviceBusy(null);
    setDeviceNotice('设备绑定完成。之后每一笔写操作都需要在这台设备上完成验证。');
    await syncStatus();
    await refreshQuietly();
  }

  async function handleRemoveDevice(deviceId: string) {
    if (deviceBusy !== null) return;

    setDeviceError(null);
    setDeviceNotice(null);

    if (removePassword.length === 0) {
      setDeviceError('删除设备需要输入交易密码。');
      return;
    }

    setDeviceBusy(deviceId);
    try {
      await securityApi.removeDevice(deviceId, removePassword);
    } catch (error) {
      setRemovePassword('');
      setDeviceError(readErrorMessage(error, '设备删除失败，请核对交易密码后重试。'));
      setDeviceBusy(null);
      return;
    }

    setRemovePassword('');
    setRemovingId(null);
    setDeviceBusy(null);
    setDeviceNotice('设备已删除，该设备不能再用于交易核验。');
    await syncStatus();
    await refreshQuietly();
  }

  const canRegister = configured && environment.supported && deviceBusy === null;

  return (
    <section className="panel" aria-labelledby={titleId} aria-busy={loading}>
      <div className="plan-section">
        <h2 id={titleId}>安全中心</h2>
        <p>
          办理业务时，请先核对方案，再完成「交易密码 + 已绑定设备」两项核验。没有可用设备时无法执行，不会改为仅密码通过。
        </p>
      </div>

      <div className="plan-summary">
        <p>
          交易密码：{status ? (configured ? '已设置' : '未设置') : loading ? '读取中…' : '未知'}
        </p>
        <p>
          已绑定设备：{status ? `${status.devices.length} 台` : loading ? '读取中…' : '未知'}
        </p>
        {locked ? (
          <p role="alert" style={alertStyle}>
            交易密码验证已锁定，解锁时间 {formatTimestamp(lockedUntil)}。锁定期间所有写操作保持阻断。
          </p>
        ) : null}
        {status?.note ? <p style={hintStyle}>{status.note}</p> : null}
        {loadError ? (
          <p role="alert" style={alertStyle}>
            {loadError}
          </p>
        ) : null}
      </div>

      {status === null ? (
        <div className="plan-section">
          <p role="status">
            {loading
              ? '正在读取安全状态…'
              : '安全状态未能读取，暂时不能修改交易密码或绑定设备，请重新读取。'}
          </p>
          {!loading ? (
            <button
              className="button button--ghost"
              type="button"
              onClick={() => {
                void loadStatus();
              }}
            >
              重新读取
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <section className="plan-section" aria-labelledby={passwordHeadingId}>
            <h3 id={passwordHeadingId}>{configured ? '修改交易密码' : '首次设置交易密码'}</h3>
            <p>
              交易密码仅用于本应用的模拟核验，不是真实银行密码；请勿把它发到聊天里，也不要与登录密码相同。
            </p>
            <FeatureEntry title={configured?'修改交易密码':'设置交易密码'} description="保护资金操作，点击后设置或修改。"><form className="form-grid" onSubmit={handlePasswordSubmit} noValidate>
              {configured ? (
                <label className="field" htmlFor={oldPwId}>
                  当前交易密码
                  <input
                    id={oldPwId}
                    name="current-password"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={oldPassword}
                    onChange={(event) => setOldPassword(event.target.value)}
                    disabled={savingPassword}
                  />
                </label>
              ) : null}
              <label className="field" htmlFor={newPwId}>
                新交易密码（8–64 个字符，含字母和数字）
                <input
                  id={newPwId}
                  name="new-password"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  disabled={savingPassword}
                />
              </label>
              <label className="field" htmlFor={confirmPwId}>
                再次输入新交易密码
                <input
                  id={confirmPwId}
                  name="confirm-password"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  disabled={savingPassword}
                />
              </label>
              <div style={actionRowStyle}>
                <button
                  className="button button--primary"
                  type="submit"
                  disabled={savingPassword}
                  aria-busy={savingPassword}
                >
                  {savingPassword ? '正在保存…' : configured ? '保存新交易密码' : '设置交易密码'}
                </button>
              </div>
              {passwordError ? (
                <p role="alert" style={alertStyle}>
                  {passwordError}
                </p>
              ) : null}
              {passwordNotice ? (
                <p role="status" style={noticeStyle}>
                  {passwordNotice}
                </p>
              ) : null}
            </form></FeatureEntry>
          </section>

          <section className="plan-section" aria-labelledby={deviceHeadingId}>
            <h3 id={deviceHeadingId}>设备绑定</h3>
            <p>{environment.message}</p>
            {!environment.supported ? (
              <p role="alert" style={alertStyle}>
                {environment.hint ?? '当前环境无法执行设备验证，绑定会明确失败，不会假装成功。'}
              </p>
            ) : null}
            <p style={hintStyle}>
              绑定与删除都需要交易密码。验证由浏览器和系统完成，应用不读取生物特征或设备私钥。通行密钥可能由系统同步，并非只绑定一台物理设备。
            </p>

            {deviceError ? (
              <p role="alert" style={alertStyle}>
                {deviceError}
              </p>
            ) : null}
            {deviceNotice ? (
              <p role="status" style={noticeStyle}>
                {deviceNotice}
              </p>
            ) : null}

            {status.devices.length === 0 ? (
              <p>
                还没有已绑定设备。没有设备时所有写操作都会被阻断，系统不会自动绑定，请在这里主动绑定一台设备。
              </p>
            ) : (
              <ul style={listStyle}>
                {status.devices.map((device) => (
                  <li key={device.id} style={deviceRowStyle}>
                    <div style={rowStyle}>
                      <div style={{ minWidth: 0 }}>
                        <strong>{device.name}</strong>
                        <div style={metaStyle}>
                          绑定于 {formatTimestamp(Date.parse(device.createdAt))} · 域名 {device.rpId}
                        </div>
                      </div>
                      <button
                        className="button button--ghost"
                        type="button"
                        aria-expanded={removingId === device.id}
                        onClick={() => {
                          setRemovingId(device.id);
                          setRemovePassword('');
                          setDeviceError(null);
                          setDeviceNotice(null);
                        }}
                        disabled={deviceBusy !== null}
                      >
                        {removingId === device.id ? '待确认删除' : '删除'}
                      </button>
                    </div>
                    {removingId === device.id ? (
                      <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                        <p>
                          删除后这台设备不能再用于交易核验；删除全部设备会阻断所有写操作。确认删除需要输入交易密码。
                        </p>
                        <label className="field" htmlFor={removePwId}>
                          交易密码
                          <input
                            id={removePwId}
                            name="remove-device-password"
                            type="password"
                            autoComplete="off"
                            spellCheck={false}
                            value={removePassword}
                            onChange={(event) => setRemovePassword(event.target.value)}
                            disabled={deviceBusy !== null}
                          />
                        </label>
                        <div style={actionRowStyle}>
                          <button
                            className="button button--primary"
                            type="button"
                            onClick={() => {
                              void handleRemoveDevice(device.id);
                            }}
                            disabled={deviceBusy !== null}
                            aria-busy={deviceBusy === device.id}
                          >
                            {deviceBusy === device.id ? '正在删除…' : '确认删除'}
                          </button>
                          <button
                            className="button button--ghost"
                            type="button"
                            onClick={() => {
                              setRemovingId(null);
                              setRemovePassword('');
                            }}
                            disabled={deviceBusy !== null}
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            <h4>绑定新设备</h4>
            {!configured ? (
              <p role="status">请先设置交易密码，之后才能绑定设备。</p>
            ) : null}
            <FeatureEntry title="绑定验证设备" description="核验交易密码，将当前设备用于交易确认。"><form className="form-grid" onSubmit={handleRegisterDevice} noValidate>
              <label className="field" htmlFor={deviceNameId}>
                设备名称
                <input
                  id={deviceNameId}
                  name="device-name"
                  type="text"
                  maxLength={40}
                  autoComplete="off"
                  placeholder="例如：家里的笔记本"
                  value={deviceName}
                  onChange={(event) => setDeviceName(event.target.value)}
                  disabled={!canRegister}
                />
              </label>
              <label className="field" htmlFor={devicePwId}>
                交易密码
                <input
                  id={devicePwId}
                  name="device-password"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={devicePassword}
                  onChange={(event) => setDevicePassword(event.target.value)}
                  disabled={!canRegister}
                />
              </label>
              <div style={actionRowStyle}>
                <button
                  className="button button--primary"
                  type="submit"
                  disabled={!canRegister}
                  aria-busy={deviceBusy === 'register'}
                >
                  {deviceBusy === 'register' ? '等待设备验证…' : '核验并绑定此设备'}
                </button>
              </div>
            </form></FeatureEntry>
          </section>
        </>
      )}
    </section>
  );
}

export interface TransactionRiskReason {
  code: string;
  title: string;
  detail: string;
}

export interface TransactionRisk {
  level: string;
  reasons: TransactionRiskReason[];
  note: string;
}

export interface TransactionGateProps {
  plan: Plan;
  disabled: boolean;
  onVerified: (pair: ProofPair) => Promise<void>;
  onVerifying?: (busy: boolean) => void;
  risk?: TransactionRisk;
}

function riskLabel(level: string): string {
  switch (level.toLowerCase()) {
    case 'high':
      return '高';
    case 'medium':
      return '中';
    case 'low':
      return '低';
    default:
      return level;
  }
}

export function TransactionGate({ plan, disabled, onVerified, onVerifying, risk }: TransactionGateProps) {
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const passwordId = `${baseId}-password`;
  const ackId = `${baseId}-ack`;

  const [password, setPassword] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);

  const environment = deviceEnvironment();
  const requireAck = (risk?.level ?? '').toLowerCase() === 'high';
  const lockedUntil = status?.lockedUntil ?? 0;
  const locked = lockedUntil > Date.now();
  const noDevices = status !== null && status.devices.length === 0;
  const hardBlocked = !environment.supported || noDevices;

  useEffect(() => {
    let cancelled = false;
    securityApi
      .status()
      .then((next) => {
        if (cancelled) return;
        setStatus(next);
        setStatusLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setStatusLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [plan.id]);

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || disabled) return;

    setError(null);

    if (!environment.supported) {
      setError(environment.hint ? `${environment.message}${environment.hint}` : environment.message);
      return;
    }

    if (noDevices) {
      setError('当前账户没有已绑定设备，按规则写操作一律阻断；请先在安全中心绑定设备。');
      return;
    }

    if (password.length === 0) {
      setError('请输入交易密码后再核验。');
      return;
    }

    if (requireAck && !acknowledged) {
      setError('请先勾选「我已核对风险线索、收款对象与用途」。');
      return;
    }

    setBusy(true);
    onVerifying?.(true);
    try {
      const pair = await verifyTransaction(plan.id, password, requireAck && acknowledged);
      await onVerified(pair);
    } catch (caught) {
      setError(readErrorMessage(caught, '核验未完成，计划未执行。'));
    } finally {
      setPassword('');
      setBusy(false);
      onVerifying?.(false);
    }
  }

  return (
    <form
      className="plan-section"
      onSubmit={handleVerify}
      noValidate
      aria-busy={busy}
      aria-labelledby={headingId}
    >
      <h3 id={headingId}>交易核验（交易密码 + 已绑定设备）</h3>

      <div className="plan-summary">
        <p>
          计划「{plan.title}」预计资金影响 {money(plan.impactCents)}。
        </p>
        <p>
          请核对对象、金额和时间，再输入交易密码并完成设备验证。两项都通过才会执行这份方案；设备验证取消或失败时，不会执行。
        </p>
      </div>

      {risk ? (
        <div className="plan-summary">
          <p>
            风险等级：<strong>{riskLabel(risk.level)}</strong>
          </p>
          {risk.reasons.length > 0 ? (
            <ul>
              {risk.reasons.map((reason) => (
                <li key={reason.code}>
                  <strong>{reason.title}</strong>：{reason.detail}
                </li>
              ))}
            </ul>
          ) : null}
          {risk.note ? <p>{risk.note}</p> : null}
        </div>
      ) : null}

      {!environment.supported ? (
        <p role="alert" style={alertStyle}>
          {environment.message}
          {environment.hint ? ` ${environment.hint}` : ''}
          本次计划不会自动执行，也不会自动完成设备绑定。{' '}
          <a href="#/security">前往安全中心</a>
        </p>
      ) : null}

      {environment.supported && noDevices ? (
        <p role="alert" style={alertStyle}>
          当前账户没有已绑定设备，按规则写操作一律阻断；本次计划不会执行，也不会自动绑定设备。{' '}
          <a href="#/security">前往安全中心绑定设备</a>
        </p>
      ) : null}

      {locked ? (
        <p role="alert" style={alertStyle}>
          交易密码验证已锁定，解锁时间 {formatTimestamp(lockedUntil)}；锁定期间无法执行计划。
        </p>
      ) : null}

      {environment.supported && statusLoaded && status === null ? (
        <p role="status" style={hintStyle}>
          设备状态未能读取，核验时仍会由服务端重新校验；已确认在安全中心绑定过设备可继续。
        </p>
      ) : null}

      {disabled ? (
        <p role="status" style={hintStyle}>
          该计划当前不可执行或已完成，核验入口已关闭。
        </p>
      ) : null}

      <label className="field" htmlFor={passwordId}>
        交易密码
        <input
          id={passwordId}
          name="transaction-password"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy || disabled || hardBlocked}
        />
      </label>

      {requireAck ? (
        <label className="field" htmlFor={ackId} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <input
            id={ackId}
            name="risk-acknowledged"
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            disabled={busy || disabled}
          />
          <span>我已核对风险线索、收款对象与用途；本次计划不会自动执行，需要我在此确认。</span>
        </label>
      ) : null}

      {error ? (
        <p role="alert" style={alertStyle}>
          {error}
        </p>
      ) : null}

      <div style={actionRowStyle}>
        <button
          className="button button--primary"
          type="submit"
          disabled={busy || disabled || hardBlocked}
          aria-busy={busy}
        >
          {busy ? '正在核验…' : '核验并确认执行（模拟）'}
        </button>
        <a className="button button--ghost" href="#/security">
          安全中心
        </a>
      </div>
    </form>
  );
}
