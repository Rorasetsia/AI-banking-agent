import {DateTimePicker} from './DateTimePicker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  Leaf,
  Lock,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { day, money, request } from '../api';
import type { PageProps } from '../types';
import type { GreenCategory, GreenReport } from '../green-types';
import './GreenInsights.css';

const EVIDENCE_PREVIEW = 4;

type OverrideChoice = 'auto' | GreenCategory;

const CATEGORY_LABELS: Record<GreenCategory, string> = {
  fuel: '燃油',
  public_transport: '公共交通',
  topup: '交通卡充值',
  ride_hail: '网约车',
  charging: '充电',
  unknown: '未识别',
  excluded: '不计入',
};

const TRAFFIC_KEYS: GreenCategory[] = ['public_transport', 'ride_hail', 'fuel', 'charging'];

const OVERRIDE_CATEGORIES: GreenCategory[] = [
  'public_transport',
  'ride_hail',
  'fuel',
  'charging',
  'topup',
  'unknown',
  'excluded',
];

const SHANGHAI_MONTH = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
});

function monthOfNow(iso: string): string {
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return '';
  const parts = SHANGHAI_MONTH.formatToParts(time);
  const year = parts.find(part => part.type === 'year')?.value ?? '';
  const month = parts.find(part => part.type === 'month')?.value ?? '';
  return year && month ? `${year}-${month}` : '';
}

function safeDay(value: string): string {
  return Number.isNaN(new Date(value).getTime()) ? value : day(value);
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function describeExpenseDiff(value: number | null): string {
  if (value === null) return '暂无可比数据';
  if (value === 0) return '与上月基本持平';
  return `${value > 0 ? '多' : '少'} ${money(Math.abs(value))}`;
}

function describeShareDiff(value: number | null): string {
  if (value === null) return '暂无可比数据';
  const points = value * 100;
  if (Math.abs(points) < 0.05) return '与上月基本持平';
  return `${points > 0 ? '+' : ''}${points.toFixed(1)} 个百分点`;
}

function SkeletonShell() {
  return (
    <div className="gf-skeleton" aria-hidden="true">
      <div className="gf-skel gf-skel-toolbar" />
      <div className="gf-skel-grid">
        <div className="gf-col">
          <div className="gf-skel gf-skel-main" />
          <div className="gf-skel gf-skel-mid" />
        </div>
        <div className="gf-col">
          <div className="gf-skel gf-skel-side" />
          <div className="gf-skel gf-skel-side" />
        </div>
      </div>
    </div>
  );
}

export function GreenInsights(props: PageProps) {
  const { state, send, busy, refresh, navigate } = props;

  const maxMonth = useMemo(() => monthOfNow(state.now), [state.now]);
  const [month, setMonth] = useState<string>(() => maxMonth);
  const [report, setReport] = useState<GreenReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [showAllEvidence, setShowAllEvidence] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftCategory, setDraftCategory] = useState<OverrideChoice>('auto');
  const [prefMinutes, setPrefMinutes] = useState('');
  const [prefCarDays, setPrefCarDays] = useState('');
  const [prefError, setPrefError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [lastAsk, setLastAsk] = useState<string | null>(null);

  const seq = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const loadReport = useCallback(async (target: string, options?: { quiet?: boolean }) => {
    if (!target) {
      setLoading(false);
      setError('无法确定当前服务时间，请刷新页面后重试。');
      return;
    }
    const ticket = seq.current + 1;
    seq.current = ticket;
    if (!options?.quiet) setLoading(true);
    setError(null);
    try {
      const next = await request<GreenReport>(`/green?month=${encodeURIComponent(target)}`);
      if (!alive.current || ticket !== seq.current) return;
      setReport(next);
      setLoading(false);
    } catch (err) {
      if (!alive.current || ticket !== seq.current) return;
      setLoading(false);
      setError(messageOf(err, '绿色报告暂时无法加载，请稍后重试。'));
    }
  }, []);

  useEffect(() => {
    if(state.green?.consent!==true)setReport(null);
    void loadReport(month);
  }, [month, loadReport, state.userId, state.now, state.green?.consent]);

  useEffect(() => {
    if (!report) return;
    const { maxExtraMinutes, requiredCarDays } = report.preferences;
    setPrefMinutes(maxExtraMinutes === undefined ? '' : String(maxExtraMinutes));
    setPrefCarDays(requiredCarDays === undefined ? '' : String(requiredCarDays));
  }, [report]);

  useEffect(() => {
    if (maxMonth && month && month > maxMonth) setMonth(maxMonth);
  }, [maxMonth, month]);

  const reloadAfterChange = useCallback(async () => {
    await loadReport(month, { quiet: true });
    try {
      await refresh();
    } catch {
      // 报告已更新；账户状态刷新失败不阻断当前界面，用户可再次保存或刷新页面。
    }
  }, [loadReport, month, refresh]);

  const changeMonth = (next: string) => {
    if (!next) return;
    const target = maxMonth && next > maxMonth ? maxMonth : next;
    if (target === month) return;
    seq.current += 1;
    setReport(null);
    setError(null);
    setActionError(null);
    setAiError(null);
    setShowAllEvidence(false);
    setEditingId(null);
    setLoading(true);
    setMonth(target);
  };

  const submitConsent = async (enabled: boolean) => {
    if (pending) return;
    if (!enabled) {
      const confirmed = window.confirm(
        '撤回后绿色监测会停止更新，已展示的分析也不再提供；这不会释放或划转任何资金。确定撤回吗？',
      );
      if (!confirmed) return;
    }
    setPending('consent');
    setActionError(null);
    setAiError(null);
    if (!enabled) {
      setReport(null);
      setEditingId(null);
    }
    try {
      await request<Record<string, unknown>>('/green/consent', { enabled });
      await loadReport(month);
      try {
        await refresh();
      } catch {
        // 授权状态已更新，账户状态刷新失败不阻断界面。
      }
    } catch (err) {
      setActionError(messageOf(err, enabled ? '授权没有完成，请重试。' : '撤回没有完成，请重试。'));
      if (!enabled) await loadReport(month, { quiet: true });
    } finally {
      if (alive.current) setPending(null);
    }
  };

  const savePreferences = async () => {
    if (pending) return;
    const minutesRaw = prefMinutes.trim();
    const carRaw = prefCarDays.trim();
    const minutes = Number(minutesRaw);
    const carDays = Number(carRaw);
    if (!minutesRaw || !Number.isInteger(minutes) || minutes < 0 || minutes > 120) {
      setPrefError('请填写 0–120 之间的整数分钟数，例如 15。');
      return;
    }
    if (!carRaw || !Number.isInteger(carDays) || carDays < 0 || carDays > 7) {
      setPrefError('请填写 0–7 之间的整数天数，例如 2。');
      return;
    }
    setPrefError(null);
    setPending('prefs');
    setActionError(null);
    try {
      await request<Record<string, unknown>>('/green/preferences', {
        maxExtraMinutes: minutes,
        requiredCarDays: carDays,
      });
      await reloadAfterChange();
    } catch (err) {
      setPrefError(messageOf(err, '条件没有保存成功，请重试。'));
    } finally {
      if (alive.current) setPending(null);
    }
  };

  const saveOverride = async (transactionId: string) => {
    if (pending) return;
    setPending(`override:${transactionId}`);
    setActionError(null);
    try {
      await request<Record<string, unknown>>('/green/override', {
        transactionId,
        category: draftCategory,
      });
      setEditingId(null);
      await reloadAfterChange();
    } catch (err) {
      setActionError(messageOf(err, '更正没有保存，请重试。'));
    } finally {
      if (alive.current) setPending(null);
    }
  };

  const toggleEditor = (transactionId: string) => {
    setDraftCategory('auto');
    setEditingId(current => (current === transactionId ? null : transactionId));
  };

  const focusTransaction = (transactionId: string) => {
    try {
      window.sessionStorage.setItem('xiaotai.green.transactionFocus', transactionId);
    } catch {
      // 无法写入会话存储时仍然尝试跳转到账单页。
    }
    navigate?.('bills');
  };

  const askAi = async (text: string) => {
    if (aiBusy || busy) return;
    setAiBusy(true);
    setAiError(null);
    setLastAsk(text);
    try {
      await send(text);
    } catch (err) {
      setAiError(messageOf(err, '助手暂时没有回应，可以重试。'));
    } finally {
      if (alive.current) setAiBusy(false);
    }
  };

  const evidence = report?.evidence ?? [];
  const currentGoals = (report?.goals ?? []).filter(goal => goal.status === 'reserved');
  const visibleEvidence = showAllEvidence ? evidence : evidence.slice(0, EVIDENCE_PREVIEW);
  const aiDisabled = aiBusy || busy;

  return (
    <div className="green-finance">
      <header className="gf-hero gf-insights-header">
        <svg className="gf-hero-leaf" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
          <path
            d="M14 104C14 56 50 20 104 16c4 54-32 90-90 88Z"
            fill="currentColor"
            opacity="0.16"
          />
          <path
            d="M22 96C42 68 66 44 96 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            opacity="0.45"
          />
        </svg>
        <p className="gf-eyebrow">
          <Leaf size={14} aria-hidden="true" />
          绿色金融 · 出行与消费
        </p>
        <h2>消费表现与依据</h2>
        <p className="gf-hero-sub">查看已授权交通支付，纠正分类，了解数据缺口。</p>
        <p className="gf-hero-small">独立沙箱 · 合成数据</p>
      </header>

      {actionError ? (
        <div className="gf-alert" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <p>{actionError}</p>
          <button
            type="button"
            className="gf-btn gf-btn-ghost gf-btn-sm"
            onClick={() => setActionError(null)}
          >
            知道了
          </button>
        </div>
      ) : null}

      {!report ? (
        <>
          {error ? (
            <div className="gf-alert" role="alert">
              <AlertTriangle size={18} aria-hidden="true" />
              <p>{error}</p>
              <button
                type="button"
                className="gf-btn gf-btn-ghost gf-btn-sm"
                onClick={() => void loadReport(month)}
              >
                <RefreshCw size={15} aria-hidden="true" />
                重新加载
              </button>
            </div>
          ) : (
            <p className="gf-sr" role="status">
              正在加载绿色分析…
            </p>
          )}
          <SkeletonShell />
        </>
      ) : !report.consent ? (
        <section className="gf-card gf-consent" aria-labelledby="gf-consent-title">
          <span className="gf-consent-icon">
            <Lock size={20} aria-hidden="true" />
          </span>
          <h2 id="gf-consent-title">授权后查看属于你的绿色分析</h2>
          <p className="gf-consent-lead">
            绿色分析需要读取本账户的消费记录与分类，用来判断出行习惯。授权之前，这里不会出现任何个人分析、统计或已有安排。
          </p>
          <ul className="gf-consent-list">
            <li>
              <Check size={16} aria-hidden="true" />
              仅分析本账户的消费记录与分类
            </li>
            <li>
              <Check size={16} aria-hidden="true" />
              不修改你的原始账单
            </li>
            <li>
              <Check size={16} aria-hidden="true" />
              随时可以撤回授权
            </li>
          </ul>
          <button
            type="button"
            className="gf-btn gf-btn-primary"
            onClick={() => void submitConsent(true)}
            disabled={pending !== null}
          >
            {pending === 'consent' ? '正在授权…' : '授权并查看分析'}
          </button>
          <p className="gf-hint">
            独立沙箱 · 合成数据 · 评级规则为本项目演示设定，非官方认证。
          </p>
        </section>
      ) : (
        <>
          {error ? (
            <div className="gf-alert" role="alert">
              <AlertTriangle size={18} aria-hidden="true" />
              <p>{error}</p>
              <button
                type="button"
                className="gf-btn gf-btn-ghost gf-btn-sm"
                onClick={() => void loadReport(month)}
              >
                <RefreshCw size={15} aria-hidden="true" />
                重新加载
              </button>
            </div>
          ) : null}

          <div className="gf-toolbar">
            <div className="gf-field">
              <label htmlFor="gf-month">查看月份</label>
              <DateTimePicker
                id="gf-month"
                className="gf-month"
                type="month"
                value={month}
                max={maxMonth || undefined}
                onChange={changeMonth}
              />
            </div>
            <p className="gf-toolbar-note">服务时钟：{maxMonth || '未知'}（Asia/Shanghai）</p>
          </div>

          <div className="gf-grid">
            <div className="gf-col">
              <section className="gf-card" aria-labelledby="gf-level-title">
                <div className="gf-card-head">
                  <h2 id="gf-level-title">{month} 绿色出行概览</h2>
                  <span className={`gf-level gf-level-${report.level.code}`}>
                    {report.level.code === 'insufficient' ? '暂不足以评估' : report.level.label}
                  </span>
                </div>
                <p className="gf-reason">{report.level.reason}</p>
                {report.level.code === 'insufficient' ? (
                  <p className="gf-hint">
                    记录不足时不会给出分数，也不用估算值填充；数据积累后可以再看一次。
                  </p>
                ) : null}
                <p className="gf-hint">{report.coverage.note}</p>

                <ul className="gf-stats">
                  <li>
                    <span className="gf-stat-value">{report.coverage.ratedCount}</span>
                    <span className="gf-stat-label">可评级支付笔数</span>
                  </li>
                  <li>
                    <span className="gf-stat-value">{money(report.current.totalCents)}</span>
                    <span className="gf-stat-label">识别交通支付金额</span>
                  </li>
                  <li>
                    <span className="gf-stat-value">
                      {report.coverage.recognizedCount} / {report.coverage.eligibleCount}
                    </span>
                    <span className="gf-stat-label">识别 / 符合条件记录</span>
                  </li>
                  <li>
                    <span className="gf-stat-value">{report.coverage.distinctDays} 天</span>
                    <span className="gf-stat-label">有支付记录的天数</span>
                  </li>
                </ul>
                <p className="gf-hint">
                  以上“笔数”都是支付记录条数，不代表里程、油耗或减碳量
                  {report.coverage.excludedCount > 0
                    ? `；另有 ${report.coverage.excludedCount} 条记录按规则不计入。`
                    : '。'}
                </p>

                <div className="gf-bars">
                  {TRAFFIC_KEYS.map(key => {
                    const amount = report.current.amounts[key];
                    const count = report.current.counts[key];
                    const share =
                      report.current.totalCents > 0
                        ? Math.min(1, amount / report.current.totalCents)
                        : 0;
                    return (
                      <div className="gf-bar-row" key={key}>
                        <div className="gf-bar-head">
                          <span className="gf-bar-name">{CATEGORY_LABELS[key]}</span>
                          <span className="gf-bar-meta">
                            {count} 笔 · {money(amount)}
                          </span>
                        </div>
                        <div className="gf-bar-track" aria-hidden="true">
                          <span
                            className="gf-bar-fill"
                            style={{ width: `${(share * 100).toFixed(1)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="gf-hint">
                  交通卡充值：{report.current.counts.topup} 笔 ·{' '}
                  {money(report.current.amounts.topup)}，单独列出，不并入上面的出行分类。
                </p>

                <div className="gf-trend">
                  <h3>与 {report.previousMonth || '上月'} 对比</h3>
                  {report.trend.comparable ? (
                    <ul className="gf-trend-list">
                      <li>交通支付费用：{describeExpenseDiff(report.trend.expenseDifferenceCents)}</li>
                      <li>公共支付比例：{describeShareDiff(report.trend.publicShareDifference)}</li>
                    </ul>
                  ) : (
                    <p className="gf-hint">
                      {report.trend.note || '本月与上月的可比数据不足，暂不做对比。'}
                    </p>
                  )}
                  {report.trend.comparable && report.trend.note ? (
                    <p className="gf-hint">{report.trend.note}</p>
                  ) : null}
                  {report.trend.comparable ? (
                    <p className="gf-hint">
                      这里只描述费用与结构的变化，不代表收益、节省或减碳结果。
                    </p>
                  ) : null}
                </div>

                <details className="gf-details">
                  <summary>
                    <ChevronDown size={16} aria-hidden="true" />
                    数据与规则
                  </summary>
                  <div className="gf-details-body">
                    {report.rules.length > 0 ? (
                      <>
                        <h4>评级规则</h4>
                        <ul className="gf-list">
                          {report.rules.map((rule, index) => (
                            <li key={`rule-${index}`}>{rule}</li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                    {report.limitations.length > 0 ? (
                      <>
                        <h4>已知限制</h4>
                        <ul className="gf-list">
                          {report.limitations.map((item, index) => (
                            <li key={`limit-${index}`}>{item}</li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                    <p className="gf-hint">评级规则为本项目演示设定，非官方认证。</p>
                  </div>
                </details>
              </section>

              <section className="gf-card" aria-labelledby="gf-evidence-title">
                <div className="gf-card-head">
                  <h2 id="gf-evidence-title">为什么这样判断</h2>
                  <span className="gf-count">{evidence.length} 条依据</span>
                </div>
                <p className="gf-hint">
                  依据来自本账户的支付记录与分类规则；点开某条可以纠正它的绿色标签。
                </p>
                {evidence.length === 0 ? (
                  <p className="gf-empty">本月还没有可用于评估的支付记录。</p>
                ) : (
                  <>
                    <ul className="gf-evidence">
                      {visibleEvidence.map(item => {
                        const isEditing = editingId === item.transactionId;
                        const isSaving = pending === `override:${item.transactionId}`;
                        return (
                          <li className="gf-evidence-row" key={item.transactionId}>
                            <div className="gf-evidence-top">
                              <span className="gf-evidence-date">{safeDay(item.date)}</span>
                              <span className="gf-evidence-merchant">{item.merchant}</span>
                              <span className="gf-evidence-amount">{money(item.amountCents)}</span>
                            </div>
                            <div className="gf-evidence-tags">
                              <span className={`gf-tag gf-tag-${item.category}`}>
                                {CATEGORY_LABELS[item.category]}
                              </span>
                              <span className="gf-tag gf-tag-plain">
                                {item.source === 'user' ? '我的更正' : '规则识别'}
                              </span>
                              <span className="gf-tag gf-tag-plain">
                                {item.rated ? '计入评级' : '未计入评级'}
                              </span>
                            </div>
                            <p className="gf-evidence-reason">{item.reason}</p>
                            <div className="gf-evidence-actions">
                              <button
                                type="button"
                                className="gf-linkbtn"
                                aria-expanded={isEditing}
                                onClick={() => toggleEditor(item.transactionId)}
                              >
                                <ChevronDown size={14} aria-hidden="true" />
                                纠正绿色分类
                              </button>
                              <button
                                type="button"
                                className="gf-linkbtn"
                                onClick={() => focusTransaction(item.transactionId)}
                              >
                                <ArrowRight size={14} aria-hidden="true" />
                                查看原始流水
                              </button>
                            </div>
                            {isEditing ? (
                              <div className="gf-override">
                                <div className="gf-override-field">
                                  <label htmlFor={`gf-cat-${item.transactionId}`}>绿色分类</label>
                                  <select
                                    id={`gf-cat-${item.transactionId}`}
                                    value={draftCategory}
                                    onChange={event =>
                                      setDraftCategory(event.target.value as OverrideChoice)
                                    }
                                  >
                                    <option value="auto">恢复自动判断</option>
                                    {OVERRIDE_CATEGORIES.map(category => (
                                      <option value={category} key={category}>
                                        {CATEGORY_LABELS[category]}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <button
                                  type="button"
                                  className="gf-btn gf-btn-primary gf-btn-sm"
                                  onClick={() => void saveOverride(item.transactionId)}
                                  disabled={pending !== null}
                                >
                                  <Check size={15} aria-hidden="true" />
                                  {isSaving ? '保存中…' : '保存更正'}
                                </button>
                                <button
                                  type="button"
                                  className="gf-btn gf-btn-ghost gf-btn-sm"
                                  onClick={() => setEditingId(null)}
                                  disabled={isSaving}
                                >
                                  取消
                                </button>
                                <p className="gf-hint gf-override-note">
                                  更正只调整绿色标签，不会改变原账单的金额与商户信息。
                                </p>
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                    {evidence.length > EVIDENCE_PREVIEW ? (
                      <button
                        type="button"
                        className="gf-btn gf-btn-ghost gf-btn-sm"
                        aria-expanded={showAllEvidence}
                        onClick={() => setShowAllEvidence(current => !current)}
                      >
                        {showAllEvidence
                          ? '只看前 8 条'
                          : `展开其余 ${evidence.length - EVIDENCE_PREVIEW} 条`}
                      </button>
                    ) : null}
                  </>
                )}
              </section>
            </div>

            <div className="gf-col">
              <section className="gf-card" aria-labelledby="gf-next-title">
                <div className="gf-card-head">
                  <h2 id="gf-next-title">可以尝试的下一步</h2>
                </div>
                <p className="gf-hint">这些建议由规则生成，不会自动执行任何操作。</p>
                {report.suggestions.length === 0 ? (
                  <p className="gf-empty">本月暂时没有具体建议，下个月可以再看一次。</p>
                ) : (
                  report.suggestions.slice(0, 3).map(suggestion => (
                    <article className="gf-suggest" key={suggestion.id}>
                      <h3>{suggestion.title}</h3>
                      <p>{suggestion.detail}</p>
                      <button
                        type="button"
                        className="gf-btn gf-btn-ghost gf-btn-sm"
                        onClick={() =>
                          void askAi(`${suggestion.question}（当前查看月份：${month}）`)
                        }
                        disabled={aiDisabled}
                      >
                        <Sparkles size={15} aria-hidden="true" />
                        问问AI
                      </button>
                    </article>
                  ))
                )}
                <div className="gf-ask-main">
                  <button
                    type="button"
                    className="gf-btn gf-btn-primary"
                    onClick={() =>
                      void askAi(`分析${month}的绿色消费表现，并说明依据与适合我的改善方式`)
                    }
                    disabled={aiDisabled}
                  >
                    <Sparkles size={16} aria-hidden="true" />
                    {aiBusy ? '正在交给助手…' : '让AI帮我分析'}
                  </button>
                  <p className="gf-hint">
                    会向统一助手发送一条只读问题，不会创建计划，也不会改动账单。
                  </p>
                </div>
                {aiError ? (
                  <div className="gf-alert" role="alert">
                    <AlertTriangle size={18} aria-hidden="true" />
                    <p>{aiError}</p>
                    <button
                      type="button"
                      className="gf-btn gf-btn-ghost gf-btn-sm"
                      onClick={() => {
                        if (lastAsk) void askAi(lastAsk);
                      }}
                      disabled={aiDisabled || !lastAsk}
                    >
                      <RefreshCw size={15} aria-hidden="true" />
                      重试
                    </button>
                  </div>
                ) : null}
              </section>

              <details className="gf-card gf-details-card">
                <summary>
                  <ChevronDown size={16} aria-hidden="true" />
                  补充生活条件
                </summary>
                <div className="gf-details-body">
                  <p className="gf-hint">
                    只用来调整建议里的生活方式偏好，不涉及金额、转账或授权。
                  </p>
                  <div className="gf-form-row">
                    <label htmlFor="gf-minutes">每天可多花的通勤时间（分钟）</label>
                    <input
                      id="gf-minutes"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={120}
                      step={5}
                      value={prefMinutes}
                      onChange={event => setPrefMinutes(event.target.value)}
                      placeholder="0–120"
                    />
                  </div>
                  <div className="gf-form-row">
                    <label htmlFor="gf-car-days">每周需要开车出行的天数</label>
                    <input
                      id="gf-car-days"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={7}
                      step={1}
                      value={prefCarDays}
                      onChange={event => setPrefCarDays(event.target.value)}
                      placeholder="0–7"
                    />
                  </div>
                  {prefError ? (
                    <p className="gf-error" role="alert">
                      <AlertTriangle size={14} aria-hidden="true" />
                      {prefError}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    className="gf-btn gf-btn-primary gf-btn-sm"
                    onClick={() => void savePreferences()}
                    disabled={pending !== null}
                  >
                    {pending === 'prefs' ? '保存中…' : '保存条件'}
                  </button>
                </div>
              </details>

              <details className="gf-card gf-details-card">
                <summary>
                  <ChevronDown size={16} aria-hidden="true" />
                  数据授权
                </summary>
                <div className="gf-details-body">
                  <p className="gf-reason">
                    绿色分析已在本账户授权（版本 {report.version}）。只使用本账户的消费记录与分类，不修改原始账单。
                  </p>
                  <button
                    type="button"
                    className="gf-btn gf-btn-danger gf-btn-sm"
                    onClick={() => void submitConsent(false)}
                    disabled={pending !== null}
                  >
                    {pending === 'consent' ? '处理中…' : '撤回绿色分析授权'}
                  </button>
                  <p className="gf-hint">撤回后绿色监测停止更新，但不会释放或划转任何资金。</p>
                </div>
              </details>

              {report.activeWatches.length > 0 || currentGoals.length > 0 ? (
                <section className="gf-card" aria-labelledby="gf-arrange-title">
                  <div className="gf-card-head">
                    <h2 id="gf-arrange-title">我的绿色安排</h2>
                    <span className="gf-count">
                      {report.activeWatches.length + currentGoals.length} 项
                    </span>
                  </div>
                  <ul className="gf-arrange">
                    {report.activeWatches.map(watch => (
                      <li key={watch.id}>
                        <span className="gf-arrange-title">{watch.title}</span>
                        <span className="gf-tag gf-tag-plain">{({active:'观察中',paused:'已暂停'} as Record<string,string>)[watch.status]??watch.status}</span>
                        <span className="gf-hint">至 {safeDay(watch.expiresAt)}</span>
                      </li>
                    ))}
                    {currentGoals.map(goal => (
                      <li key={goal.id}>
                        <span className="gf-arrange-title">{goal.title}</span>
                        <span className="gf-tag gf-tag-plain">{({reserved:'已预留',released:'已释放'} as Record<string,string>)[goal.status]??goal.status}</span>
                        <span className="gf-hint">{money(goal.amountCents)}</span>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="gf-btn gf-btn-ghost gf-btn-sm"
                    onClick={() => navigate?.('tasks')}
                    disabled={!navigate}
                  >
                    查看任务与凭证
                    <ArrowRight size={15} aria-hidden="true" />
                  </button>
                  <p className="gf-hint">这里只是摘要，具体操作在任务与凭证里完成。</p>
                </section>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default GreenInsights;
