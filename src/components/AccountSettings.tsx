import { useCallback, useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertCircle, CheckCircle2, KeyRound, ShieldCheck, UserRound } from 'lucide-react';
import { accountApi } from '../api';
import type { AccountSettingsStatus } from '../api';
import type { PageProps } from '../types';

function formatLockTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function readableError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : '保存失败，请稍后重试。';
}

export function AccountSettings({ navigate, onAccountSettingsChanged }: PageProps) {
  const baseId = useId();
  const currentId = `${baseId}-current-code`;
  const codeId = `${baseId}-operation-code`;
  const confirmId = `${baseId}-confirm-code`;
  const [status, setStatus] = useState<AccountSettingsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [currentCode, setCurrentCode] = useState('');
  const [code, setCode] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await accountApi.settings());
      setLoadError('');
    } catch (nextError) {
      setLoadError(readableError(nextError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const configured = status?.operationCodeConfigured === true;
  const lockedUntil = status?.operationLockedUntil ?? 0;
  const locked = lockedUntil > Date.now();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError('');
    setNotice('');
    if (!/^\d{6}$/.test(code)) {
      setError('操作码需要是 6 位数字。');
      return;
    }
    if (code !== confirmCode) {
      setError('两次输入的操作码不一致，请重新核对。');
      return;
    }
    if (configured && !/^\d{6}$/.test(currentCode)) {
      setError('请输入当前 6 位操作码。');
      return;
    }
    setSaving(true);
    try {
      const next = await accountApi.setOperationCode(code, configured ? currentCode : undefined);
      setStatus(previous => previous ? { ...previous, ...next } : previous);
      setCurrentCode('');
      setCode('');
      setConfirmCode('');
      setNotice(
        configured
          ? '操作码已更新。家庭提醒等非资金设置请使用新操作码。'
          : '操作码已设置。之后创建家庭、加入家庭和管理家庭时使用它，不需要输入交易密码。',
      );
      await onAccountSettingsChanged?.();
    } catch (nextError) {
      setCurrentCode('');
      setCode('');
      setConfirmCode('');
      setError(readableError(nextError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-page">
      <section className="panel settings-profile-card">
        <span className="settings-avatar"><UserRound size={23} /></span>
        <div>
          <span className="settings-kicker">当前沙箱账户</span>
          <h2>{status?.displayName || '沙箱用户'}</h2>
          <p>{status?.accountName || '小苔活期账户'} · 合成数据，不连接真实银行</p>
        </div>
        <span className="status">本机会话</span>
      </section>

      <section className="panel settings-code-card" aria-labelledby={`${baseId}-operation-title`}>
        <div className="settings-code-head">
          <span className="settings-code-icon"><KeyRound size={20} /></span>
          <div>
            <h2 id={`${baseId}-operation-title`}>操作码</h2>
            <p>用于家庭提醒等非资金设置。与交易密码分开，输入频率更高，也不影响资金核验。</p>
          </div>
          <span className={configured ? 'status' : 'status status--warn'}>
            {loading ? '读取中' : configured ? '已设置' : '未设置'}
          </span>
        </div>

        {loadError ? (
          <div className="settings-inline-alert" role="alert">
            <AlertCircle size={17} />
            <span>{loadError}</span>
            <button type="button" className="text-link-button" onClick={() => void load()}>重新读取</button>
          </div>
        ) : null}

        {locked ? (
          <p className="settings-inline-alert" role="alert">
            <AlertCircle size={17} />
            <span>操作码已因连续错误暂时锁定，解锁时间 {formatLockTime(lockedUntil)}。</span>
          </p>
        ) : null}

        <form className="settings-code-form" onSubmit={event => void submit(event)} noValidate>
          {configured ? (
            <label className="field" htmlFor={currentId}>
              当前操作码
              <input
                id={currentId}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                value={currentCode}
                onChange={event => setCurrentCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                disabled={saving || locked}
                placeholder="6 位数字"
              />
            </label>
          ) : null}
          <label className="field" htmlFor={codeId}>
            {configured ? '新操作码' : '设置 6 位数字操作码'}
            <input
              id={codeId}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={code}
              onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={saving || locked}
              placeholder="例如 246810"
            />
          </label>
          <label className="field" htmlFor={confirmId}>
            再次输入操作码
            <input
              id={confirmId}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={confirmCode}
              onChange={event => setConfirmCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={saving || locked}
              placeholder="再输入一次"
            />
          </label>
          <button className="button button--primary settings-code-submit" type="submit" disabled={saving || locked}>
            {saving ? '保存中…' : configured ? '更新操作码' : '创建操作码'}
          </button>
        </form>

        {error ? <p className="settings-form-message is-error" role="alert">{error}</p> : null}
        {notice ? (
          <p className="settings-form-message is-success" role="status">
            <CheckCircle2 size={16} /> {notice}
          </p>
        ) : null}

        <div className="settings-safe-note">
          <ShieldCheck size={17} />
          <p>
            请勿把操作码设成交易密码、银行卡密码或生日。连续输错 5 次会锁定 10 分钟；操作码不会出现在聊天、页面网址或本地缓存中。
          </p>
        </div>
      </section>

      <section className="panel settings-security-link">
        <div>
          <h3>资金操作仍由交易密码和设备共同保护</h3>
          <p>转账、存取、理财、卡片和订阅变更不会使用操作码，也不会因设置操作码而降低核验要求。</p>
        </div>
        <button className="button" type="button" onClick={() => navigate?.('security')}>
          前往安全中心
        </button>
      </section>
    </div>
  );
}
