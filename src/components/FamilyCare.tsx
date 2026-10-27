import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertCircle,
  BellRing,
  Check,
  Copy,
  KeyRound,
  Link2,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { money, request } from '../api';
import type { PageProps } from '../types';

type Relation = 'parent' | 'child' | 'partner' | 'other';
type LinkRole = 'member' | 'manager';
type WorkbenchTab = 'create' | 'join' | 'manage';
type ConfirmAction =
  | { type: 'create'; relation: Relation; thresholdCents: number; shareAmount: boolean }
  | { type: 'accept'; code: string }
  | { type: 'revoke'; linkId: string }
  | { type: 'preferences'; largeAmountCents: number };

interface FamilyLink {
  id: string;
  relation: string;
  role: LinkRole;
  thresholdCents: number;
  shareAmount: boolean;
  consentAt: string;
}

interface FamilyAlert {
  id: string;
  linkId: string;
  relation: string;
  phase: string;
  at: string;
  demoAt?: string | number;
  amountCents?: number;
  title: string;
  note: string;
}

interface OwnAlert {
  id: string;
  phase: string;
  at: string;
  riskLevel: string;
  reasonCodes?: string[];
  amountCents: number;
}

interface FamilySummary {
  links: FamilyLink[];
  preferences: { largeAmountCents: number };
  alerts: FamilyAlert[];
  ownAlerts: OwnAlert[];
  operationCodeConfigured: boolean;
  operationLockedUntil?: number;
  note?: string;
}

interface InviteResult {
  code: string;
  expiresAt: number;
  note: string;
}

const RELATION_OPTIONS: { value: Relation; label: string }[] = [
  { value: 'parent', label: '父母' },
  { value: 'child', label: '子女' },
  { value: 'partner', label: '伴侣' },
  { value: 'other', label: '其他' },
];

const RELATION_LABELS: Record<string, string> = {
  parent: '父母',
  child: '子女',
  partner: '伴侣',
  other: '其他',
};
const ROLE_LABELS: Record<LinkRole, string> = {
  member: '我是被提醒者',
  manager: '我是管理人',
};
const RISK_LABELS: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
  normal: '常规',
};
const PHASE_LABELS: Record<string, string> = {
  proposed: '计划提交时',
  confirmed: '确认执行后',
  cancelled: '取消后',
};
const REASON_LABELS: Record<string, string> = {
  SCAM_CUE: '含待核查线索',
};

const MAX_CENTS = 1_000_000_000;

function parseYuan(value: string): number | null {
  const text = value.trim();
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(text)) return null;
  const [integer, fraction = ''] = text.split('.');
  const cents = Number(integer) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > MAX_CENTS) return null;
  return cents;
}

function formatDateTime(value?: string | number | null): string {
  if (value === undefined || value === null || value === '') return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return '操作没有完成，请刷新页面后重试。';
}

function actionTitle(action: ConfirmAction): string {
  switch (action.type) {
    case 'create': return '确认生成家庭邀请';
    case 'accept': return '确认加入家庭提醒';
    case 'revoke': return '确认解除提醒关系';
    case 'preferences': return '确认修改个人提醒线';
  }
}

export function FamilyCare({ navigate }: PageProps) {
  const dialogTitleId = useId();
  const operationCodeRef = useRef<HTMLInputElement | null>(null);
  const copyTimer = useRef<number | null>(null);

  const [summary, setSummary] = useState<FamilySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const [tab, setTab] = useState<WorkbenchTab>('create');
  const [relation, setRelation] = useState<Relation>('parent');
  const [inviteThreshold, setInviteThreshold] = useState('3000.00');
  const [inviteShareAmount, setInviteShareAmount] = useState(false);
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);
  const [copyHint, setCopyHint] = useState('');

  const [acceptCode, setAcceptCode] = useState('');
  const [prefsYuan, setPrefsYuan] = useState('');
  const prefsTouched = useRef(false);

  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [confirmConsent, setConfirmConsent] = useState(false);
  const [guardianConsent, setGuardianConsent] = useState(false);
  const [operationCode, setOperationCode] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [pending, setPending] = useState(false);

  const loadSummary = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await request<FamilySummary>('/family');
      setSummary(data);
      setLoadError(null);
      setLastLoadedAt(new Date().toISOString());
    } catch (error) {
      setLoadError(errorText(error));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void loadSummary(true);
    };
    const timer = window.setInterval(refresh, 15000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [loadSummary]);

  useEffect(() => {
    if (!summary || prefsTouched.current) return;
    const cents = summary.preferences?.largeAmountCents;
    if (typeof cents === 'number') setPrefsYuan((cents / 100).toFixed(2));
  }, [summary]);

  useEffect(() => () => {
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
  }, []);

  useEffect(() => {
    if (!confirmAction) return;
    document.body.classList.add('dialog-open');
    const focusTimer = window.setTimeout(() => operationCodeRef.current?.focus(), 40);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) closeConfirm();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
      document.body.classList.remove('dialog-open');
    };
  }, [confirmAction, pending]);

  const links = summary?.links ?? [];
  const alerts = summary?.alerts ?? [];
  const ownAlerts = summary?.ownAlerts ?? [];
  const operationConfigured = summary?.operationCodeConfigured === true;
  const operationLocked = (summary?.operationLockedUntil ?? 0) > Date.now();

  function openConfirm(action: ConfirmAction) {
    setConfirmAction(action);
    setConfirmConsent(false);
    setGuardianConsent(false);
    setOperationCode('');
    setConfirmError('');
  }

  function closeConfirm(force = false) {
    if (pending && !force) return;
    setConfirmAction(null);
    setConfirmConsent(false);
    setGuardianConsent(false);
    setOperationCode('');
    setConfirmError('');
  }

  function beginInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    const cents = parseYuan(inviteThreshold);
    if (cents === null) {
      setNotice({ kind: 'error', text: '提醒线需在 0.01—10,000,000 元之间，最多两位小数。' });
      return;
    }
    openConfirm({ type: 'create', relation, thresholdCents: cents, shareAmount: inviteShareAmount });
  }

  function beginAccept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    const code = acceptCode.trim().toLowerCase();
    if (!/^[a-f0-9]{24}$/.test(code)) {
      setNotice({ kind: 'error', text: '邀请码应为 24 位字符，请核对后再继续。' });
      return;
    }
    openConfirm({ type: 'accept', code });
  }

  function beginPreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    const cents = parseYuan(prefsYuan);
    if (cents === null) {
      setNotice({ kind: 'error', text: '个人提醒线需在 0.01—10,000,000 元之间，最多两位小数。' });
      return;
    }
    openConfirm({ type: 'preferences', largeAmountCents: cents });
  }

  async function executeConfirmed() {
    if (!confirmAction || pending) return;
    setConfirmError('');
    if (!operationConfigured) {
      setConfirmError('请先在账号设置中创建 6 位操作码。');
      return;
    }
    if (operationLocked) {
      setConfirmError('操作码连续验证失败，已暂时锁定，请稍后再试。');
      return;
    }
    if (!/^\d{6}$/.test(operationCode)) {
      setConfirmError('请输入 6 位数字操作码。');
      operationCodeRef.current?.focus();
      return;
    }
    if (confirmAction.type === 'create' && !confirmConsent) {
      setConfirmError('请先确认向所选管理人分享授权范围内的提醒。');
      return;
    }
    if (confirmAction.type === 'create' && confirmAction.relation === 'child' && !guardianConsent) {
      setConfirmError('子女演示档案需要确认监护人同意。');
      return;
    }
    if (confirmAction.type === 'accept' && !confirmConsent) {
      setConfirmError('请先确认仅接收授权范围内的提醒。');
      return;
    }
    if (confirmAction.type === 'revoke' && !confirmConsent) {
      setConfirmError('请先确认解除关系后的影响。');
      return;
    }

    setPending(true);
    try {
      if (confirmAction.type === 'create') {
        const result = await request<InviteResult>('/family/invites', {
          relation: confirmAction.relation,
          thresholdCents: confirmAction.thresholdCents,
          shareAmount: confirmAction.shareAmount,
          consent: true,
          ...(confirmAction.relation === 'child' ? { guardianConsent: true } : {}),
          operationCode,
        });
        setInviteResult(result);
        setTab('create');
        setNotice({ kind: 'ok', text: '邀请码已生成，30 分钟内有效。请只交给希望接收提醒的管理人。' });
      } else if (confirmAction.type === 'accept') {
        const result = await request<{ id: string; status: string; note: string }>('/family/accept', {
          code: confirmAction.code,
          consent: true,
          operationCode,
        });
        setAcceptCode('');
        setTab('manage');
        setNotice({ kind: 'ok', text: result.note || '已加入家庭提醒。' });
      } else if (confirmAction.type === 'revoke') {
        const result = await request<{ status: string; note: string }>('/family/revoke', {
          linkId: confirmAction.linkId,
          operationCode,
        });
        setTab('manage');
        setNotice({ kind: 'ok', text: result.note || '已解除该提醒关系。' });
      } else {
        const result = await request<{ largeAmountCents: number; note: string }>('/family/preferences', {
          largeAmountCents: confirmAction.largeAmountCents,
          operationCode,
        });
        prefsTouched.current = false;
        setPrefsYuan((result.largeAmountCents / 100).toFixed(2));
        setNotice({ kind: 'ok', text: result.note || '个人提醒线已更新。' });
      }
      setPending(false);
      closeConfirm(true);
      await loadSummary(true);
    } catch (error) {
      setPending(false);
      setOperationCode('');
      setConfirmError(errorText(error));
      await loadSummary(true);
    }
  }

  async function copyInviteCode() {
    if (!inviteResult) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(inviteResult.code);
      setCopyHint('已复制');
    } catch {
      setCopyHint('复制失败，请手动选择');
    }
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopyHint(''), 3000);
  }

  const statusTitle = !summary
    ? '家庭提醒'
    : links.length > 0
      ? `已建立 ${links.length} 个家庭提醒关系`
      : '你还没有建立家庭提醒';
  const statusText = !summary
    ? '正在读取当前家庭关系，请稍候。'
    : links.length > 0
      ? '达到约定金额或出现待核查线索时，系统只在页面向管理人显示最少必要信息。'
      : '绑定后，家人只会在约定的大额操作发生时收到站内提醒，不会看到余额、完整流水或操作资金。';

  return (
    <div className="family-page">
      <section className={`family-status-card ${links.length === 0 ? 'family-status-card--empty' : ''}`}>
        <div className="family-status-copy">
          <span className="family-status-icon">
            {links.length > 0 ? <ShieldCheck size={21} /> : <Users size={21} />}
          </span>
          <div>
            <h3>{statusTitle}</h3>
            <p>{statusText}</p>
          </div>
        </div>
        {links.length === 0 ? (
          <div className="family-status-actions">
            <button className="button button--primary" type="button" onClick={() => setTab('create')}>创建邀请</button>
            <button className="button" type="button" onClick={() => setTab('join')}>我有邀请码</button>
          </div>
        ) : (
          <span className="status"><Check size={13} /> 家庭提醒已开启</span>
        )}
      </section>

      {notice ? (
        <p className={`family-notice family-notice--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          {notice.kind === 'error' ? <AlertCircle size={16} /> : <Check size={16} />}
          <span>{notice.text}</span>
          <button type="button" aria-label="关闭提示" onClick={() => setNotice(null)}><X size={14} /></button>
        </p>
      ) : null}

      {loadError && !summary ? (
        <section className="family-status-card family-status-card--empty" role="alert">
          <div className="family-status-copy">
            <span className="family-status-icon"><AlertCircle size={21} /></span>
            <div>
              <h3>{loading ? '正在读取家庭提醒…' : '暂时无法读取家庭提醒'}</h3>
              <p>{loadError}</p>
            </div>
          </div>
          {!loading ? (
            <button className="button" type="button" onClick={() => void loadSummary()}>
              <RefreshCcw size={15} /> 重新读取
            </button>
          ) : null}
        </section>
      ) : null}

      {summary && loadError ? (
        <p className="family-stale-note" role="status">
          自动刷新暂时失败，下方保留上次成功读取的数据。
          <button type="button" onClick={() => void loadSummary()}>重新读取</button>
        </p>
      ) : null}

      <section className="family-workbench" aria-labelledby="family-workbench-title">
        <header className="family-workbench-head">
          <div>
            <h2 id="family-workbench-title">家庭操作</h2>
            <p>{lastLoadedAt ? `最近读取 ${formatDateTime(lastLoadedAt)} · 页面可见时自动刷新` : '双方同意后才会生效'}</p>
          </div>
          {!operationConfigured && summary ? (
            <button className="family-code-callout" type="button" onClick={() => navigate?.('settings')}>
              <KeyRound size={15} />
              先设置操作码
            </button>
          ) : null}
        </header>

        <div className="family-tabs" role="tablist" aria-label="家庭提醒操作">
          {([
            ['create', '创建家庭', Plus],
            ['join', '加入家庭', Link2],
            ['manage', '家庭管理', ShieldCheck],
          ] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`family-tab ${tab === id ? 'is-active' : ''}`}
              onClick={() => setTab(id)}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>

        {tab === 'create' ? (
          <div className="family-action-card" role="tabpanel">
            <div className="family-action-heading">
              <div>
                <h3>创建家庭提醒</h3>
                <p>你是被提醒者。生成一次性邀请码，交给希望接收提醒的管理人。</p>
              </div>
              <span className="status status--warn">30 分钟有效</span>
            </div>
            <form className="family-form-grid" onSubmit={beginInvite}>
              <label className="field">
                家庭关系
                <select value={relation} onChange={event => setRelation(event.target.value as Relation)}>
                  {RELATION_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="field">
                大额提醒线（元）
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  value={inviteThreshold}
                  onChange={event => setInviteThreshold(event.target.value)}
                  placeholder="3000.00"
                />
              </label>
              <label className="field">
                金额如何展示
                <select value={inviteShareAmount ? 'show' : 'hide'} onChange={event => setInviteShareAmount(event.target.value === 'show')}>
                  <option value="hide">只提示达到提醒线</option>
                  <option value="show">同时展示事件金额</option>
                </select>
              </label>
              <div className="family-full family-inline-note">
                <ShieldCheck size={16} />
                <span>不会分享余额、完整流水、联系人或任何资金操作权限。授权确认和操作码在下一步填写。</span>
              </div>
              <button className="button button--primary family-full-mobile" type="submit">生成邀请码</button>
            </form>

            {inviteResult ? (
              <div className="family-invite-result">
                <div>
                  <span>一次性邀请码</span>
                  <code>{inviteResult.code}</code>
                </div>
                <div className="family-invite-actions">
                  <button className="button" type="button" onClick={() => void copyInviteCode()}>
                    <Copy size={15} /> {copyHint || '复制邀请码'}
                  </button>
                  <small>有效期至 {formatDateTime(inviteResult.expiresAt)}</small>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === 'join' ? (
          <div className="family-action-card" role="tabpanel">
            <div className="family-action-heading">
              <div>
                <h3>加入家庭提醒</h3>
                <p>你是管理人。输入对方转交的邀请码，只接收授权范围内的提醒。</p>
              </div>
            </div>
            <form className="family-form-grid" onSubmit={beginAccept}>
              <label className="field family-full">
                24 位邀请码
                <input
                  value={acceptCode}
                  maxLength={24}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={event => setAcceptCode(event.target.value)}
                  placeholder="粘贴或输入邀请码"
                  className="family-code-input"
                />
              </label>
              <div className="family-full family-inline-note">
                <ShieldCheck size={16} />
                <span>接受后不会取得资金操作、余额或完整账单权限。授权确认和操作码在下一步填写。</span>
              </div>
              <button className="button button--primary family-full-mobile" type="submit">接受邀请</button>
            </form>
          </div>
        ) : null}

        {tab === 'manage' ? (
          <div className="family-action-card" role="tabpanel">
            <div className="family-action-heading">
              <div>
                <h3>家庭管理</h3>
                <p>查看生效关系、更新个人提醒线或解除授权。任一方撤销都会立即停止提醒。</p>
              </div>
            </div>

            {links.length === 0 ? (
              <p className="family-empty">暂无生效中的家庭关系。创建邀请或接受邀请后，会在这里显示。</p>
            ) : (
              <ul className="family-link-list">
                {links.map(link => (
                  <li key={link.id}>
                    <div className="family-link-row">
                      <div>
                        <strong>{ROLE_LABELS[link.role]} · {RELATION_LABELS[link.relation] ?? link.relation}</strong>
                        <p className="family-mini-meta">
                          提醒线 {money(link.thresholdCents)} · {link.shareAmount ? '可展示事件金额' : '不展示事件金额'} · 同意于 {formatDateTime(link.consentAt)}
                        </p>
                      </div>
                      <button className="button family-revoke-button" type="button" onClick={() => openConfirm({ type: 'revoke', linkId: link.id })}>
                        撤销关系
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <details className="family-settings-disclosure">
              <summary>
                <span><BellRing size={16} /> 个人风险提醒线</span>
                <span>{prefsYuan ? money(parseYuan(prefsYuan) ?? 0) : '读取中'}</span>
              </summary>
              <form className="family-form-grid" onSubmit={beginPreferences}>
                <label className="field family-full">
                  只影响你自己的风险提示，不会自动扩大已同意的家庭分享范围
                  <input
                    inputMode="decimal"
                    autoComplete="off"
                    value={prefsYuan}
                    onChange={event => {
                      prefsTouched.current = true;
                      setPrefsYuan(event.target.value);
                    }}
                    placeholder="3000.00"
                  />
                </label>
                <button className="button family-full-mobile" type="submit">保存提醒线</button>
              </form>
            </details>
          </div>
        ) : null}
      </section>

      {summary ? (
        <section className="family-alert-section">
          <div className="family-section-title">
            <h2><BellRing size={17} /> 家庭提醒</h2>
            <span className="status">{alerts.length} 条</span>
          </div>
          {alerts.length === 0 ? (
            <p className="family-empty">暂无家庭提醒。页面打开时每 15 秒更新；关闭网页后不保证送达。</p>
          ) : (
            <ul className="family-alert-list">
              {alerts.map(alert => (
                <li key={alert.id}>
                  <div className="family-link-row">
                    <strong>{alert.title}</strong>
                    <span className="status status--warn">{PHASE_LABELS[alert.phase] ?? alert.phase}</span>
                  </div>
                  <p className="family-mini-meta">
                    {RELATION_LABELS[alert.relation] ?? alert.relation} · {typeof alert.amountCents === 'number' ? `金额 ${money(alert.amountCents)}` : '未授权展示金额'}
                  </p>
                  <p className="family-mini-meta">事件时间 {formatDateTime(alert.at)}{alert.demoAt !== undefined ? ` · 演示时钟 ${formatDateTime(alert.demoAt)}` : ''}</p>
                  <p className="family-alert-note">{alert.note}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {summary && ownAlerts.length > 0 ? (
        <section className="family-own-alert-section">
          <div className="family-section-title">
            <h2><AlertCircle size={17} /> 本人风险提示</h2>
            <span className="status status--warn">{ownAlerts.length} 条</span>
          </div>
          <ul className="family-alert-list">
            {ownAlerts.map(item => (
              <li key={item.id}>
                <div className="family-link-row">
                  <strong>{RISK_LABELS[item.riskLevel] ?? item.riskLevel}风险提示 · {money(item.amountCents)}</strong>
                  <span className="status">{PHASE_LABELS[item.phase] ?? item.phase}</span>
                </div>
                <p className="family-mini-meta">{formatDateTime(item.at)} · {(item.reasonCodes ?? []).map(code => REASON_LABELS[code] ?? code).join('、') || '常规规则提示'}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {confirmAction ? (
        <div
          className="family-confirm-backdrop"
          onMouseDown={event => { if (event.target === event.currentTarget) closeConfirm(); }}
        >
          <section className="family-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby={dialogTitleId}>
            <div className="family-confirm-head">
              <span className="family-status-icon"><KeyRound size={20} /></span>
              <div>
                <h3 id={dialogTitleId}>{actionTitle(confirmAction)}</h3>
                <p>家庭提醒属于非资金设置，使用独立操作码，不需要交易密码。</p>
              </div>
              <button className="icon-button" type="button" aria-label="关闭确认窗口" onClick={() => closeConfirm()} disabled={pending}>
                <X size={17} />
              </button>
            </div>

            {!operationConfigured ? (
              <div className="family-code-missing">
                <KeyRound size={19} />
                <div>
                  <strong>还没有设置操作码</strong>
                  <p>先创建一个 6 位数字操作码，再回来确认。资金操作仍使用交易密码和设备验证。</p>
                </div>
                <button className="button button--primary" type="button" onClick={() => navigate?.('settings')}>
                  去账号设置
                </button>
              </div>
            ) : (
              <div className="family-confirm-fields">
                {confirmAction.type === 'create' ? (
                  <>
                    <label className="family-consent-row">
                      <input type="checkbox" checked={confirmConsent} onChange={event => setConfirmConsent(event.target.checked)} />
                      <span>我同意向所选管理人分享上述授权范围内的提醒，并理解对方看不到我的余额和完整流水。</span>
                    </label>
                    {confirmAction.relation === 'child' ? (
                      <label className="family-consent-row">
                        <input type="checkbox" checked={guardianConsent} onChange={event => setGuardianConsent(event.target.checked)} />
                        <span>监护人同意（仅合成演示，不验证现实监护身份；请勿录入真实儿童信息）。</span>
                      </label>
                    ) : null}
                  </>
                ) : null}
                {confirmAction.type === 'accept' ? (
                  <label className="family-consent-row">
                    <input type="checkbox" checked={confirmConsent} onChange={event => setConfirmConsent(event.target.checked)} />
                    <span>我同意仅接收授权范围内的提醒，不因此取得资金操作、余额或完整账单权限。</span>
                  </label>
                ) : null}
                {confirmAction.type === 'revoke' ? (
                  <label className="family-consent-row">
                    <input type="checkbox" checked={confirmConsent} onChange={event => setConfirmConsent(event.target.checked)} />
                    <span>我理解解除后对方不再收到相关提醒，需要重新邀请才能恢复。</span>
                  </label>
                ) : null}

                <label className="field">
                  6 位操作码
                  <input
                    ref={operationCodeRef}
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={6}
                    value={operationCode}
                    onChange={event => setOperationCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="输入操作码"
                    disabled={pending || operationLocked}
                  />
                </label>
                {operationLocked ? <p className="family-form-error">操作码已暂时锁定，请稍后再试。</p> : null}
                {confirmError ? <p className="family-form-error" role="alert">{confirmError}</p> : null}
              </div>
            )}

            <div className="family-confirm-actions">
              <button className="button" type="button" onClick={() => closeConfirm()} disabled={pending}>取消</button>
              <button
                className="button button--primary"
                type="button"
                onClick={() => void executeConfirmed()}
                disabled={!operationConfigured || pending || operationLocked}
              >
                {pending ? '处理中…' : confirmAction.type === 'revoke' ? '确认撤销' : '确认并继续'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
