import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeftRight, CalendarDays, CheckCircle2, ChevronRight, CreditCard, HelpCircle, Home, KeyRound, LayoutDashboard, Leaf, LineChart, ListChecks, Loader2, Menu, MessageCircle, ReceiptText, Repeat, RotateCcw, Search, Settings, ShieldCheck, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api, accountApi, money, ApiError, request } from './api';
import { createExperienceConnector } from './connect-experience';
import type { AccountSettingsStatus } from './api';
import type { BankState, PageProps, Plan, Receipt, Route, Session, Recovery } from './types';
import { Overview, Bills } from './components/Overview';
import { Transfers, Wealth, Cards, Subscriptions, Tasks } from './components/Banking';
import { Assistant } from './components/Assistant';
import { AccountFunding } from './components/AccountFunding';
import { AccountHome } from './components/AccountHome';
import { AccountSettings } from './components/AccountSettings';
import { AccountSubpageHeader } from './components/AccountSubpageHeader';
import { FamilyCare } from './components/FamilyCare';
import { MandatesAndCharges } from './components/MandatesAndCharges';
import { SecurityCenter, TransactionGate } from './components/SecurityCenter';
import { Welcome } from './components/Welcome';
import { SidebarSurface } from './components/SidebarSurface';
import { GreenFinance } from './components/GreenFinance';
import { PageGuide } from './components/PageGuide';
import { PrimaryNavigation, PageSubnavigation, MobileNavigation } from './components/Navigation';
import type { ProofPair } from './security';

const connectExperience = createExperienceConnector({
  session: api.session,
  state: api.state,
  settings: accountApi.settings,
  unauthorized: error => error instanceof ApiError && error.code === 'UNAUTHORIZED',
});

type ToastKind = 'success' | 'error' | 'info';
interface ToastState { kind: ToastKind; message: string }
interface ChatResponse {
  reply: string;
  plan?: Plan;
  clarification?: unknown;
  answer?: unknown;
  sources?: Record<string, unknown>;
  trace?: unknown[];
  intentSource?: string;
  fallbackReason?: string;
}

const NAV: { route: Route; label: string; icon: LucideIcon; hint: string }[] = [
  { route: 'overview', label: '总览', icon: LayoutDashboard, hint: '账户、流水与计划' },
  { route: 'assistant', label: 'AI 助手', icon: MessageCircle, hint: '对话办理与追问' },
  { route: 'green', label: '绿色金融', icon: Leaf, hint: '消费选择比较、7天小目标与消费依据' },
  { route: 'bills', label: '账单洞察', icon: ReceiptText, hint: '收支结构与异常' },
  { route: 'transfers', label: '转账与收款', icon: ArrowLeftRight, hint: '转账、AA 与预约' },
  { route: 'accounts', label: '账户首页', icon: LayoutDashboard, hint: '余额、快捷操作与银行卡' },
  { route: 'funding', label: '存入与转出', icon: CreditCard, hint: '本人银行卡之间互转' },
  { route: 'wealth', label: '财富计划', icon: LineChart, hint: '产品比较与持仓' },
  { route: 'cards', label: '卡片管理', icon: CreditCard, hint: '额度、锁定与挂失' },
  { route: 'subscriptions', label: '订阅与代扣', icon: Repeat, hint: '订阅管理、自动扣款与续费' },
  { route: 'tasks', label: '预约与凭证', icon: ListChecks, hint: '生日安排、待确认方案与执行凭证' },
  { route: 'mandates', label: '扣费监测', icon: ListChecks, hint: '委托与扣费核对、有限监测及争议草稿' },
  { route: 'family', label: '家庭提醒', icon: ShieldCheck, hint: '知情绑定、大额和风险提醒' },
  { route: 'security', label: '安全中心', icon: ShieldCheck, hint: '交易密码与设备验证' },
  { route: 'settings', label: '账号设置', icon: Settings, hint: '操作码与账户资料' },
];

const PAGE_META: Record<Route, { title: string; eyebrow: string; description: string }> = {
  green: { title: '绿色金融', eyebrow: '绿色生活，财务有方', description: '比较家电与通勤成本，记录7天绿色行动' },
  cover: { title: '欢迎使用小苔', eyebrow: 'AI BANKING', description: '对话咨询、授权办理与清楚可查的结果' },
  accounts: { title: '账户服务', eyebrow: '账户总览', description: '一张卡看余额，常用操作集中在卡片下方' },
  funding: { title: '存入与转出', eyebrow: '本人互转', description: '本人合成银行卡与账户之间安全互转' },
  mandates: { title: '扣费监测', eyebrow: '有边界的委托', description: '按约定范围检查、提醒，集中核对异常与争议材料' },
  family: { title: '家庭提醒', eyebrow: '知情协作', description: '双方同意，只分享约定提醒' },
  security: { title: '安全中心', eyebrow: '双重核验', description: '交易密码与已绑定设备共同保护业务操作' },
  settings: { title: '账号设置', eyebrow: '安全偏好', description: '设置独立的非资金操作码' },
  overview: { title: '总览', eyebrow: '账户全景', description: '账户、流水与 AI 计划一屏掌握' },
  assistant: { title: 'AI 助手', eyebrow: '对话办理', description: '自然语言发起查询、计划与确认执行' },
  bills: { title: '账单洞察', eyebrow: '资金流向', description: '月度与年度收支结构及异常提示' },
  transfers: { title: '转账与收款', eyebrow: '往来资金', description: '转账、AA 收款与预约任务' },
  wealth: { title: '财富计划', eyebrow: '稳健配置', description: '产品比较、申购赎回与持仓' },
  cards: { title: '卡片管理', eyebrow: '用卡安全', description: '额度、锁定、挂失与申请' },
  subscriptions: { title: '订阅与代扣', eyebrow: '授权管理', description: '核对持续扣费授权、下次扣费与取消方案' },
  tasks: { title: '预约与凭证', eyebrow: '预约管理', description: '核对操作方案，管理预约与预留资金，查看执行凭证' },
};

const MONEY_KEYS = new Set(['amountCents', 'totalCents', 'budgetCents', 'limitCents', 'balanceCents']);
const DATE_KEYS = new Set(['executeAt', 'date', 'eventDate', 'createdAt', 'expiresAt']);
const HIDDEN_PARAM_KEYS = new Set(['cardId', 'productId', 'subscriptionId', 'scheduleId']);
const PARAM_LABELS: Record<string, string> = {
  recipient: '收款人', amountCents: '金额', memo: '备注', executeAt: '执行时间', datePhrase: '日期表述',
  participants: '参与人', totalCents: '总金额', subscriptionId: '订阅 ID', subscriptionName: '订阅',
  productId: '产品 ID', productName: '产品', shares: '份额', cardId: '卡片 ID', cardName: '卡片',
  limitCents: '额度', period: '周期', month: '月份', year: '年份', category: '分类', title: '标题',
  eventDate: '事件日期', budgetCents: '预算', daysBefore: '提前天数', scheduleId: '任务 ID',
  question: '问题', reason: '原因', actions: '组合动作',
  recipientName: '收款人', phoneTail: '手机尾号', last4: '卡片尾号', items: '预约商品', splits: '分摊明细',
};

function parseRoute(): Route {
  const raw = window.location.hash.startsWith('#/') ? window.location.hash.slice(2) : window.location.hash.replace('#', '');
  if (!raw || raw === 'cover') return 'cover';
  return NAV.find(item => item.route === raw)?.route ?? 'overview';
}

const PAGE_GUIDE_KEY = 'xiaotai.pageGuides.v1';
const OPERATION_PROMPT_KEY = 'xiaotai.operationPromptDismissed';

function todayKey(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

function readSeenGuides(): Set<Route> {
  try {
    const raw = window.localStorage.getItem(PAGE_GUIDE_KEY);
    const values = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(values)
        ? values.filter((value): value is Route => NAV.some(item => item.route === value))
        : [],
    );
  } catch {
    return new Set();
  }
}

function saveSeenGuides(seen: Set<Route>) {
  try {
    window.localStorage.setItem(PAGE_GUIDE_KEY, JSON.stringify([...seen]));
  } catch {
    /* local storage may be unavailable */
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '操作失败，请稍后重试';
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatUnknown(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(formatUnknown).join('、');
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.label === 'string' && 'value' in record) return `${record.label}：${formatUnknown(record.value)}`;
    try { return JSON.stringify(value); } catch { return '[无法显示的数据]'; }
  }
  return String(value);
}

function formatPlanParam(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') {
    if (MONEY_KEYS.has(key)) return money(value);
    if (key === 'shares') return `${value} 份`;
    if (key === 'daysBefore') return `${value} 天`;
    return String(value);
  }
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (key === 'items' && Array.isArray(value)) return value.map(item => {const p = item as Record<string, unknown>;return `${p.name} × ${p.quantity} · ${money(Number(p.priceCents))}`;}).join('；');
  if (key === 'splits' && Array.isArray(value)) return value.map(item => {const p = item as Record<string, unknown>;return `${p.name} ${money(Number(p.amountCents))}${p.status === 'self' ? '（本人）' : '（待付款）'}`;}).join('；');
  if (typeof value === 'string') {
    if (key === 'eventDate' && value.length === 10 && value[4] === '-' && value[7] === '-') return `${value.slice(0,4)}年${Number(value.slice(5,7))}月${Number(value.slice(8,10))}日`;
    if (DATE_KEYS.has(key)) return formatDateTime(value);
    if (key === 'period') return value === 'month' ? '按月' : value === 'year' ? '按年' : value;
    return value;
  }
  return formatUnknown(value);
}

function planStatusTone(status: string): string {
  return ['pending', 'executed', 'cancelled', 'expired', 'failed'].includes(status) ? status : 'unknown';
}

function planStatusLabel(status: string): string {
  switch (status) {
    case 'pending': return '待确认';
    case 'executed': return '已执行';
    case 'cancelled': return '已取消';
    case 'expired': return '已过期';
    case 'failed': return '执行失败';
    default: return status || '未知状态';
  }
}

function planStatusNote(status: string): string {
  switch (status) {
    case 'cancelled': return '计划已取消，不会产生扣款或后台任务。';
    case 'expired': return '计划已过期，请重新发起并确认。';
    case 'failed': return '执行未完成，服务端返回失败状态。请重新发起并确认。';
    default: return '当前计划不可执行，请关闭后重新发起。';
  }
}

function isPlanExpired(plan: Plan, now: string): boolean {
  const wall = Date.parse(plan.expiresAt);
  const demo = plan.demoExpiresAt ? Date.parse(plan.demoExpiresAt) : NaN;
  return (Number.isFinite(wall) && wall <= Date.now()) ||
    (Number.isFinite(demo) && demo <= Date.parse(now));
}

function planRequestText(plan: Plan): string {
  const canonical = typeof plan.requestText === 'string' ? plan.requestText.trim() : '';
  if (canonical) return canonical;
  const steps = plan.steps.map(step => {
    const details = Object.entries(step.params)
      .filter(([key, value]) => value !== null && value !== undefined && value !== '' && !HIDDEN_PARAM_KEYS.has(key) && !(key === 'recipient' && step.params.recipientName))
      .map(([key, value]) => `${PARAM_LABELS[key] ?? key} ${formatPlanParam(key, value)}`);
    return `${step.label}${details.length ? `（${details.join('，')}）` : ''}`;
  });
  if (steps.length > 0) return `按原计划重新办理：${steps.join('；')}`;
  return plan.summary || plan.title;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<BankState | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [route, setRoute] = useState<Route>(() => parseRoute());
  const routeRef = useRef<Route>(route);
  const [coverExiting, setCoverExiting] = useState(false);
  const [coverEntering, setCoverEntering] = useState(false);
  const coverEnteringFrom = useRef<Route>('overview');
  const coverTransitioning = coverExiting || coverEntering;
  const coverLayerRef = useRef<HTMLDivElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [planId, setPlanId] = useState<string | null>(null);
  const [, renderExpiry] = useState(0);
  const [fallbackPlan, setFallbackPlan] = useState<Plan | null>(null);
  const [receipts, setReceipts] = useState<Record<string, Receipt>>({});
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({});
  const [planError, setPlanError] = useState<string | null>(null);
  const [planRecovery, setPlanRecovery] = useState<Recovery | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [securityBusy, setSecurityBusy] = useState(false);
  const [accountSettings, setAccountSettings] = useState<AccountSettingsStatus | null>(null);
  const [seenGuides, setSeenGuides] = useState<Set<Route>>(() => readSeenGuides());
  const [greenConversation, setGreenConversation] = useState(false);
  const [queuedAssistantMessage, setQueuedAssistantMessage] = useState<{ id: string; text: string } | null>(null);
  const [guideRoute, setGuideRoute] = useState<Route | null>(null);
  const [showOperationPrompt, setShowOperationPrompt] = useState(false);
  const [familyAlertCount, setFamilyAlertCount] = useState(0);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelForEditBusy, setCancelForEditBusy] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const planIdRef = useRef<string | null>(null);
  const lastFocusRef = useRef<HTMLElement | null>(null);

  const dismissToast = useCallback(() => {
    if (toastTimer.current !== null) { window.clearTimeout(toastTimer.current); toastTimer.current = null; }
    setToast(null);
  }, []);

  const showToast = useCallback((message: string, kind: ToastKind = 'info') => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast({ kind, message });
    toastTimer.current = window.setTimeout(() => { setToast(null); toastTimer.current = null; }, 4500);
  }, []);


  useEffect(() => {
    routeRef.current = route;
    setDrawerOpen(false);
    if(planIdRef.current)dialogRef.current?.close();
    if (route === 'cover') {
      setGuideRoute(null);
      setShowOperationPrompt(false);
    }
  }, [route]);

  const workspaceReady = Boolean(state || bootError);

  useEffect(() => {
    const onHashChange = () => {
      const next = parseRoute();
      routeRef.current = next;
      setRoute(next);
    };
    window.addEventListener('hashchange', onHashChange);
    if (!window.location.hash) window.history.replaceState(null, '', '#/cover');
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);

  const bootstrap = useCallback(async () => {
    setBootError(null);
    try {
      const connected = await connectExperience();
      setSession(connected.session);
      setState(connected.state);
      if (connected.settings) setAccountSettings(connected.settings);
    } catch (error) {
      setBootError(error instanceof ApiError && error.code === 'UNAUTHORIZED'
        ? '未能保持模拟环境的连接。请允许此页面使用 Cookie，或用最新版 Chrome / Edge 重新打开后重试。'
        : errorMessage(error));
    }
  }, []);

  useEffect(() => { void bootstrap(); }, [bootstrap]);

  useEffect(() => {
    if (!state || !session || route === 'cover' || route === 'green' || coverTransitioning) return;
    if (!seenGuides.has(route)) setGuideRoute(route);
  }, [route, state, session, seenGuides, coverTransitioning]);

  useEffect(() => {
    if (!state || !session || route !== 'family' || coverTransitioning) return;
    if (!accountSettings || accountSettings.operationCodeConfigured) return;
    if (guideRoute) return;
    try {
      if (window.localStorage.getItem(OPERATION_PROMPT_KEY) === todayKey()) return;
    } catch {
      /* Keep the reminder when storage is unavailable. */
    }
    setShowOperationPrompt(true);
  }, [route, state, session, accountSettings, guideRoute, coverTransitioning]);

  const closeGuide = useCallback(() => {
    if (!guideRoute) return;
    const next = new Set(seenGuides);
    next.add(guideRoute);
    setSeenGuides(next);
    saveSeenGuides(next);
    setGuideRoute(null);
  }, [guideRoute, seenGuides]);

  const dismissOperationPrompt = useCallback(() => {
    try {
      window.localStorage.setItem(OPERATION_PROMPT_KEY, todayKey());
    } catch {
      /* The reminder can reappear next time. */
    }
    setShowOperationPrompt(false);
  }, []);

  useEffect(()=>{
    if(!session)return;
    let stopped=false;
    const poll=async()=>{if(document.visibilityState!=='visible')return;try{const summary=await request<{alerts:unknown[]}>('/family');if(!stopped)setFamilyAlertCount(summary.alerts.length);}catch{/* The family page exposes connection failures with retry. */}};
    void poll();const timer=window.setInterval(()=>void poll(),15000);
    return()=>{stopped=true;window.clearInterval(timer);};
  },[session]);

  const refresh = useCallback(async () => {
    try {
      const next = await api.state();
      setState(next);
    } catch (error) {
      const message = errorMessage(error);
      showToast(message, 'error');
      throw error;
    }
  }, [showToast]);

  const refreshAccountSettings = useCallback(async () => {
    try {
      setAccountSettings(await accountApi.settings());
    } catch {
      /* 页面自身保留重试入口；不阻断其他账户功能。 */
    }
  }, []);

  const syncState = useCallback(async (): Promise<BankState | null> => {
    try {
      const next = await api.state();
      setState(next);
      return next;
    } catch (error) {
      showToast(`刷新权威状态失败：${errorMessage(error)}`, 'error');
      return null;
    }
  }, [showToast]);

  const navigate = useCallback((next: Route) => {
    routeRef.current = next;
    setRoute(next);
    setDrawerOpen(false);
    setSearchOpen(false);
    setQuery('');
    const nextHash = `#/${next}`;
    if (window.location.hash !== nextHash) window.location.hash = nextHash;
  }, []);

  const enterWorkspace = useCallback((next: Route) => {
    if (routeRef.current !== 'cover') return;
    setCoverExiting(true);
    navigate(next);
  }, [navigate]);

  const returnHome = useCallback(() => {
    if (routeRef.current === 'cover' || coverTransitioning) return;
    coverEnteringFrom.current = routeRef.current;
    setDrawerOpen(false);
    setGuideRoute(null);
    setShowOperationPrompt(false);
    setCoverEntering(true);
  }, [coverTransitioning]);

  useEffect(() => {
    if (!coverTransitioning) return;
    if ((coverExiting && route === 'cover') ||
        (coverEntering && route !== coverEnteringFrom.current)) {
      setCoverExiting(false); setCoverEntering(false); return;
    }
    if (coverExiting && !workspaceReady) return;
    const layer = coverLayerRef.current;
    if (!layer) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const end = coverEntering ? 'translateX(0)' : 'translateX(-100%)';
    const animation = layer.animate(
      [{ transform: coverEntering ? 'translateX(-100%)' : 'translateX(0)' }, { transform: end }],
      { duration: reduced.matches ? 0 : 820, easing: 'cubic-bezier(.76,0,.24,1)', fill: 'forwards' },
    );
    const reduceMotion = () => { if (reduced.matches) animation.finish(); };
    reduced.addEventListener('change', reduceMotion);
    animation.onfinish = () => {
      layer.style.transform = end;
      if (coverEntering) navigate('cover');
      setCoverExiting(false); setCoverEntering(false);
      animation.cancel();
    };
    return () => {
      reduced.removeEventListener('change', reduceMotion);
      animation.cancel(); layer.style.removeProperty('transform');
    };
  }, [route, coverEntering, coverExiting, coverTransitioning, workspaceReady, navigate]);

  const openPlan = useCallback((plan: Plan) => {
    lastFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    planIdRef.current = plan.id;
    setFallbackPlan(plan);
    setPlanId(plan.id);
    setPlanError(null);
    setPlanRecovery(null);
    setConfirmBusy(false);
    setCancelBusy(false);
    setCancelForEditBusy(false);
    setEditMode(false);
    setEditText('');
    setEditBusy(false);
  }, []);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = (await api.chat(trimmed, 'llm')) as ChatResponse;
      try {
        const next = await api.state();
        setState(next);
      } catch (error) {
        showToast(`回复已收到，但刷新状态失败：${errorMessage(error)}`, 'error');
      }
      if (result.plan) {
        openPlan(result.plan);
      } else if (routeRef.current !== 'assistant' && routeRef.current !== 'overview') {
        navigate('assistant');
      }
    } catch (error) {
      const message = errorMessage(error);
      showToast(message, 'error');
      try { setState(await api.state()); } catch { /* 保留原始业务错误 */ }
      throw error;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [navigate, openPlan, showToast]);

  const handleReset = useCallback(async () => {
    const approved = window.confirm('确定重置当前独立模拟环境？消息、计划、任务和流水都会恢复初始合成数据，且无法撤销。');
    if (!approved) return;
    setResetting(true);
    try {
      const next = await api.reset();
      setState(next);
      planIdRef.current = null;
      setPlanId(null);
      setFallbackPlan(null);
      setPlanError(null);
      setPlanRecovery(null);
      setReceipts({});
      setStatusOverrides({});
      setEditMode(false);
      setEditText('');
      setEditBusy(false);
      setCancelForEditBusy(false);
      showToast('模拟环境已重置为初始合成数据', 'success');
    } catch (error) {
      showToast(errorMessage(error), 'error');
    } finally {
      setResetting(false);
    }
  }, [showToast]);

  const statePlan = planId && state ? state.plans.find(plan => plan.id === planId) ?? null : null;
  const activePlan = statePlan ?? (fallbackPlan && fallbackPlan.id === planId ? fallbackPlan : null);
  const activePlanId = activePlan?.id ?? null;
  const overrideStatus = activePlan ? statusOverrides[activePlan.id] : undefined;
  const returnedStatus = activePlan?.status ?? '';
  const authoritativeStatus = activePlan ? (returnedStatus === 'pending' && overrideStatus ? overrideStatus : returnedStatus || overrideStatus || 'pending') : '';
  const activeReceipt = activePlan ? statePlan?.receipt ?? receipts[activePlan.id] ?? activePlan.receipt : undefined;
  const expired = activePlan && state ? authoritativeStatus === 'pending' && isPlanExpired(activePlan, state.now) : false;
  const activeStatus=expired?'expired':authoritativeStatus;
  const canEditPlan = Boolean(activePlan && activeStatus !== 'executed' && ['pending', 'cancelled', 'expired', 'failed'].includes(activeStatus));
  const planActionDisabled = confirmBusy || securityBusy || cancelBusy || cancelForEditBusy || editBusy;
  useEffect(()=>{
    if(!activePlan||authoritativeStatus!=='pending')return;
    const delay=Date.parse(activePlan.expiresAt)-Date.now();
    if(!Number.isFinite(delay)||delay<=0)return;
    const timer=window.setTimeout(()=>renderExpiry(n=>n+1),Math.min(delay+20,2147483647));
    return()=>window.clearTimeout(timer);
  },[activePlanId,activePlan?.expiresAt,authoritativeStatus]);

  const closePlanDialog = useCallback(() => { if(!securityBusy&&!confirmBusy)dialogRef.current?.close(); }, [securityBusy,confirmBusy]);

  const handleDialogClose = useCallback(() => {
    planIdRef.current = null;
    setPlanId(null);
    setFallbackPlan(null);
    setPlanError(null);
    setPlanRecovery(null);
    setEditMode(false);
    setEditText('');
    setEditBusy(false);
    setCancelForEditBusy(false);
    document.body.classList.remove('dialog-open');
    const target = lastFocusRef.current;
    lastFocusRef.current = null;
    if (target && document.contains(target)) target.focus();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (activePlan && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      document.body.classList.add('dialog-open');
    }
    if (!activePlan && dialog.open) dialog.close();
  }, [activePlanId]);

  useEffect(() => {
    planIdRef.current = activePlanId;
    setEditMode(false);
    setEditText('');
    setEditBusy(false);
    setCancelForEditBusy(false);
    setPlanError(null);
    setPlanRecovery(null);
  }, [activePlanId]);

  useEffect(() => {
    if (editMode) editRef.current?.focus();
  }, [editMode]);

  useEffect(() => () => { document.body.classList.remove('dialog-open'); }, []);

  const handleConfirm = useCallback(async (proofs: ProofPair) => {
    if (!activePlan || !state || confirmBusy || cancelBusy || cancelForEditBusy || editBusy || editMode) return;
    if (isPlanExpired(activePlan, state.now)) {
      setPlanError('计划已超过有效期，不能再确认执行。请刷新核对，或取消后重新发起。');
      showToast('计划已过期，不能确认执行', 'error');
      await syncState();
      return;
    }
    setConfirmBusy(true);
    setPlanError(null);
    setPlanRecovery(null);
    const plan = activePlan;
    try {
      if(planIdRef.current!==plan.id)return;
      const result = await api.confirm(plan, proofs);
      const status = result.status || 'executed';
      const receipt = result.receipt;
      setStatusOverrides(previous => ({ ...previous, [plan.id]: status }));
      if (receipt) setReceipts(previous => ({ ...previous, [plan.id]: receipt }));
      if (status === 'executed') {
        showToast(receipt ? '计划已执行，凭证已生成' : '计划已执行，凭证暂不可用，请刷新核对', receipt ? 'success' : 'error');
        try { await refresh(); } catch { showToast('计划已执行，但最新状态刷新失败；当前凭证已保留。', 'error'); }
      } else if (status === 'cancelled' || status === 'expired' || status === 'failed') {
        setPlanError(`服务端返回状态：${planStatusLabel(status)}。计划未执行，请刷新核对。`);
        showToast('计划未执行，请核对最新状态', 'error');
        await syncState();
      } else {
        setPlanError(`服务端返回状态：${status}，未确认执行成功。请刷新核对。`);
        showToast('计划未返回成功状态，请核对', 'error');
        await syncState();
      }
    } catch (error) {
      const message = errorMessage(error);
      const business = error instanceof ApiError && error.status >= 400 && error.status < 500;
      const recovery = error instanceof ApiError ? error.recovery : undefined;
      const refreshed = await syncState();
      const current = refreshed?.plans.find(item => item.id === plan.id) ?? null;
      if (current?.receipt) setReceipts(previous => ({ ...previous, [plan.id]: current.receipt as Receipt }));
      if (current?.status === 'executed') {
        setStatusOverrides(previous => ({ ...previous, [plan.id]: 'executed' }));
        setPlanError(null);
        setPlanRecovery(null);
        showToast('服务端已确认执行，已同步最新状态与凭证。', 'success');
      } else if (current && (current.status === 'cancelled' || current.status === 'expired')) {
        setStatusOverrides(previous => ({ ...previous, [plan.id]: current.status }));
        setPlanError(`服务端最新状态：${planStatusLabel(current.status)}。本计划不会执行。`);
        showToast(`服务端最新状态：${planStatusLabel(current.status)}`, 'error');
      } else {
        setPlanError(business ? message : `${message} 确认结果未知，请先刷新或在“预约与凭证”核对；仍待确认时，可重试同一计划，系统会防止重复执行。`);
        setPlanRecovery(recovery ?? null);
        showToast(business ? message : '确认结果未知，请刷新核对', 'error');
      }
    } finally {
      setConfirmBusy(false);
    }
  }, [activePlan, cancelBusy, cancelForEditBusy, confirmBusy, editBusy, editMode, refresh, showToast, state, syncState]);

  const handleCancelPlan = useCallback(async () => {
    if (!activePlan || confirmBusy || cancelBusy || cancelForEditBusy || editBusy || editMode) return;
    setCancelBusy(true);
    setPlanError(null);
    setPlanRecovery(null);
    const plan = activePlan;
    try {
      const result = await api.cancel(plan);
      const status = result.status || 'cancelled';
      setStatusOverrides(previous => ({ ...previous, [plan.id]: status }));
      if (status === 'cancelled') {
        showToast('计划已取消', 'success');
        await syncState();
      } else if (status === 'executed') {
        setPlanError('服务端显示计划已执行，无法取消。请查看执行凭证。');
        showToast('计划已执行，无法取消', 'error');
        await syncState();
      } else if (status === 'expired' || status === 'failed') {
        setPlanError(`服务端最新状态：${planStatusLabel(status)}。计划不会执行。`);
        await syncState();
      } else {
        setPlanError(`服务端返回状态：${status}，计划未取消失败确认。请刷新核对。`);
        await syncState();
      }
    } catch (error) {
      const message = errorMessage(error);
      const business = error instanceof ApiError && error.status >= 400 && error.status < 500;
      const recovery = error instanceof ApiError ? error.recovery : undefined;
      const refreshed = await syncState();
      const current = refreshed?.plans.find(item => item.id === plan.id) ?? null;
      if (current?.receipt) setReceipts(previous => ({ ...previous, [plan.id]: current.receipt as Receipt }));
      if (current && (current.status === 'cancelled' || current.status === 'expired' || current.status === 'failed')) {
        setStatusOverrides(previous => ({ ...previous, [plan.id]: current.status }));
        setPlanError(null);
        showToast(`服务端最新状态：${planStatusLabel(current.status)}`, 'success');
      } else if (current?.status === 'executed') {
        setStatusOverrides(previous => ({ ...previous, [plan.id]: 'executed' }));
        setPlanError('计划已执行，无法取消。请查看执行凭证。');
        showToast('计划已执行，无法取消', 'error');
      } else {
        setPlanError(business ? message : `${message} 取消失败结果未知，请先刷新或在“预约与凭证”核对，暂不要重复操作。`);
        setPlanRecovery(recovery ?? null);
        showToast(business ? message : '取消失败结果未知，请刷新核对', 'error');
      }
    } finally {
      setCancelBusy(false);
    }
  }, [activePlan, cancelBusy, cancelForEditBusy, confirmBusy, editBusy, editMode, showToast, syncState]);

  const openEditor = useCallback((prefill?: string) => {
    if (!activePlan) return;
    setEditText(prefill ?? planRequestText(activePlan));
    setEditMode(true);
    setPlanError(null);
    setPlanRecovery(null);
  }, [activePlan]);

  const requestEdit = useCallback(async (prefill?: string) => {
    if (!activePlan || confirmBusy || cancelBusy || cancelForEditBusy || editBusy) return;
    if (activeStatus === 'executed') {
      setPlanError('该计划已执行，不能修改；原执行凭证已保留。');
      return;
    }
    if (activeStatus !== 'pending') {
      if (activeStatus === 'cancelled' || activeStatus === 'expired' || activeStatus === 'failed') {
        openEditor(prefill);
      } else {
        setPlanError('当前计划状态不明确，请先刷新核对后再修改。');
        await syncState();
      }
      return;
    }
    setCancelForEditBusy(true);
    setPlanError(null);
    setPlanRecovery(null);
    const plan = activePlan;
    try {
      const result = await api.cancel(plan);
      const status = result.status || 'cancelled';
      setStatusOverrides(previous => ({ ...previous, [plan.id]: status }));
      if (status === 'executed') {
        setPlanError('该计划已执行，无法修改；原执行凭证已保留。');
        showToast('该计划已执行，无法修改', 'error');
        await syncState();
        return;
      }
      if (status !== 'cancelled') {
        const refreshed = await syncState();
        const current = refreshed?.plans.find(item => item.id === plan.id) ?? null;
        if (current?.status === 'executed') {
          setStatusOverrides(previous => ({ ...previous, [plan.id]: 'executed' }));
          setPlanError('该计划已执行，无法修改；原执行凭证已保留。');
          showToast('该计划已执行，无法修改', 'error');
          return;
        }
        if (current && (current.status === 'cancelled' || current.status === 'expired' || current.status === 'failed')) {
          setStatusOverrides(previous => ({ ...previous, [plan.id]: current.status }));
          openEditor(prefill);
          return;
        }
        setPlanError(`服务端返回状态：${status}，尚未确认原计划取消，暂不能生成新方案。请先刷新核对。`);
        showToast('未能确认原计划取消', 'error');
        return;
      }
      const refreshed = await syncState();
      const current = refreshed?.plans.find(item => item.id === plan.id) ?? null;
      if (current?.status === 'executed') {
        setStatusOverrides(previous => ({ ...previous, [plan.id]: 'executed' }));
        setPlanError('该计划已执行，无法修改；原执行凭证已保留。');
        showToast('该计划已执行，无法修改', 'error');
        return;
      }
      openEditor(prefill);
      showToast('原计划已取消，请修改后生成新方案', 'success');
    } catch (error) {
      const message = errorMessage(error);
      const recovery = error instanceof ApiError ? error.recovery : undefined;
      const refreshed = await syncState();
      const current = refreshed?.plans.find(item => item.id === plan.id) ?? null;
      if (current?.status === 'executed') {
        setStatusOverrides(previous => ({ ...previous, [plan.id]: 'executed' }));
        setPlanError('该计划已执行，无法修改；原执行凭证已保留。');
        showToast('该计划已执行，无法修改', 'error');
        return;
      }
      if (current && (current.status === 'cancelled' || current.status === 'expired' || current.status === 'failed')) {
        setStatusOverrides(previous => ({ ...previous, [plan.id]: current.status }));
        openEditor(prefill);
        showToast('原计划已取消，请修改后生成新方案', 'success');
        return;
      }
        setPlanError(`${message} 未能确认原计划已取消，暂不能生成新方案。请先刷新或在“预约与凭证”核对。`);
      setPlanRecovery(recovery ?? null);
      showToast(message, 'error');
    } finally {
      setCancelForEditBusy(false);
    }
  }, [activePlan, activeStatus, cancelBusy, cancelForEditBusy, confirmBusy, editBusy, openEditor, showToast, syncState]);

  const handleGenerate = useCallback(async () => {
    if (!activePlan || editBusy) return;
    const text = editText.trim();
    if (!text) {
      setPlanError('请输入完整请求后再生成新方案。');
      return;
    }
    const beforeId = activePlan.id;
    setEditBusy(true);
    setPlanError(null);
    setPlanRecovery(null);
    try {
      await send(text);
      setEditMode(false);
      if (planIdRef.current === beforeId) closePlanDialog();
    } catch (error) {
      setPlanError(errorMessage(error));
    } finally {
      setEditBusy(false);
    }
  }, [activePlan, closePlanDialog, editBusy, editText, send]);

  const handlePlanRecovery = useCallback((action: Recovery['actions'][number]) => {
    if (action.kind === 'navigate' && action.route) {
      navigate(action.route);
      closePlanDialog();
      return;
    }
    if (action.kind === 'refresh') {
      void syncState();
      return;
    }
    if (action.kind === 'edit') {
      void requestEdit(planRecovery?.draft);
    }
  }, [closePlanDialog, navigate, planRecovery, requestEdit, syncState]);

  const renderPlanIssues = () => (
    <>
      {planError && <div className='plan-error' role='alert'><AlertCircle size={16} /><span>{planError}</span></div>}
      {planRecovery && (
        <div className='plan-recovery' role='group' aria-label={planRecovery.title}>
          <strong>{planRecovery.title}</strong>
          <div className='plan-actions'>
            {planRecovery.actions.map((action, index) => {
              if (action.kind === 'navigate' && !action.route) return null;
              return (
                <button key={`${action.kind}-${index}`} type='button' className='button button--ghost' onClick={() => handlePlanRecovery(action)} disabled={planActionDisabled}>
                  {action.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );

  const searchResults = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return NAV;
    return NAV.filter(item => `${item.label} ${item.hint} ${item.route}`.toLowerCase().includes(term));
  }, [query]);

  // Keep this keyed layer mounted across the route change: the current face,
  // forest canvas and light ring slide together above the live workspace.
  const coverLayer = (route === 'cover' || coverTransitioning) && (
    <div key="cover" ref={coverLayerRef} className="cover-layer" data-exiting={coverExiting} data-entering={coverEntering} inert={coverTransitioning}>
      <Welcome onStart={() => enterWorkspace('overview')} onExplore={enterWorkspace} />
    </div>
  );
  if (route === 'cover') return <>{coverLayer}</>;

  if (!state) {
    return (
      <>{coverLayer}<div className='boot-screen' inert={coverTransitioning}>
        <div className='boot-card'>
          <div className='brand brand--boot'>
            <span className='brand-mark'><Leaf size={20} /></span>
            <span className='brand-copy'><strong>小苔</strong><small>AI BANKING</small></span>
          </div>
          {bootError ? (
            <>
              <div className='boot-error' role='alert'><AlertCircle size={20} /><p>{bootError}</p></div>
              <button type='button' className='button button--primary' onClick={() => void bootstrap()}><RotateCcw size={16} />重新连接</button>
            </>
          ) : (
            <div className='boot-loading' role='status'><Loader2 size={20} className='spin' /><p>正在连接独立银行模拟环境…</p></div>
          )}
        </div>
      </div></>
    );
  }

  const page = PAGE_META[route];
  const displayName = session?.user.name ?? state.profile.name;
  const initial = Array.from(displayName.trim())[0] ?? '客';
  const pageProps: PageProps = {
    state,
    send,
    busy,
    openPlan,
    refresh,
    navigate,
    askAssistant: text => {
      if (!text.trim() || busyRef.current) return;
      setGreenConversation(false);
      setQueuedAssistantMessage({ id: crypto.randomUUID(), text: text.trim() });
      navigate('assistant');
    },
    onAccountSettingsChanged: refreshAccountSettings,
  };

  const renderPage = () => {
    switch (route) {
      case 'overview': return <Overview {...pageProps} />;
      case 'accounts': return <AccountHome {...pageProps} />;
      case 'funding': return <AccountFunding {...pageProps} />;
      case 'mandates': return <MandatesAndCharges {...pageProps} />;
      case 'family': return <FamilyCare {...pageProps} />;
      case 'security': return <SecurityCenter refresh={refresh} />;
      case 'settings': return <AccountSettings {...pageProps} />;
      case 'assistant': return <>{greenConversation&&<div className='green-return-link'><button type='button' onClick={() => navigate('green')}><Leaf size={14} /> 返回绿色金融</button></div>}<Assistant {...pageProps} queuedMessage={queuedAssistantMessage} consumeQueuedMessage={id => setQueuedAssistantMessage(current => current?.id === id ? null : current)} /></>;
      case 'green': return <GreenFinance {...pageProps} send={async text=>{setGreenConversation(true);await pageProps.send(text);}} />;
      case 'bills': return <Bills {...pageProps} />;
      case 'transfers': return <Transfers {...pageProps} />;
      case 'wealth': return <Wealth {...pageProps} />;
      case 'cards': return <Cards {...pageProps} />;
      case 'subscriptions': return <Subscriptions {...pageProps} />;
      case 'tasks': return <Tasks {...pageProps} />;
      default: return null;
    }
  };

  const ToastIcon = toast?.kind === 'success' ? CheckCircle2 : toast?.kind === 'error' ? AlertCircle : ShieldCheck;

  return (
    <>{coverLayer}<div className='app-shell' inert={coverTransitioning}>
      {drawerOpen && <button type='button' className='sidebar-backdrop' aria-label='关闭导航' onClick={() => setDrawerOpen(false)} />}
      <aside id='workspace-sidebar' className={`sidebar ${drawerOpen ? 'sidebar--open' : ''}`} aria-label='主导航'>
        <SidebarSurface />
        <div className='brand-row'>
          <div className='brand'>
            <span className='brand-mark'><Leaf size={20} /></span>
            <span className='brand-copy'><strong>小苔</strong><small>AI BANKING</small></span>
          </div>
          <button type='button' className='icon-button sidebar-close' aria-label='关闭导航' onClick={() => setDrawerOpen(false)}><X size={18} /></button>
        </div>
        <button type='button' className='nav-item sidebar-home' onClick={returnHome}>
          <Home size={18} /><span>回到首页</span>
        </button>
        <p className='sidebar-section-label'>工作台</p>
        <PrimaryNavigation route={route} onNavigate={navigate} />
        <div className='sidebar-footer'>
          <button type='button' className={`nav-item nav-item--utility ${route === 'security' ? 'is-active' : ''}`} onClick={() => navigate('security')} aria-current={route === 'security' ? 'page' : undefined}>
            <ShieldCheck size={18} /><span>安全中心</span>
          </button>
          <button type='button' className={`nav-item nav-item--utility ${route === 'settings' ? 'is-active' : ''}`} onClick={() => navigate('settings')} aria-current={route === 'settings' ? 'page' : undefined}>
            <Settings size={18} /><span>账号设置</span>
          </button>
          {session && !session.llmConfigured && <p className='mode-hint'>AI暂未连接，请联系团队配置服务端模型。</p>}
          <div className='sandbox-card'>
            <div className='sandbox-card-head'><ShieldCheck size={16} /><span>独立银行模拟环境</span></div>
            <p>合成数据 · 会话隔离</p>
            <button type='button' className='sandbox-reset' onClick={() => void handleReset()} disabled={resetting}>
              {resetting ? <Loader2 size={14} className='spin' /> : <RotateCcw size={14} />}
              {resetting ? '重置中…' : '重置模拟环境'}
            </button>
          </div>
        </div>
      </aside>

      <div className='app-main'>
        <header className='topbar'>
          <button type='button' className='icon-button topbar-menu' aria-label='打开导航' aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}><Menu size={20} /></button>
          <div className='topbar-heading'><span className='topbar-eyebrow'>{page.eyebrow}</span><h1>{page.title}</h1></div>
          <div className='topbar-tools'>
            <div className='nav-search' role='search'>
              <Search size={16} aria-hidden='true' />
              <input
                type='search'
                value={query}
                onChange={event => { setQuery(event.target.value); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
                onBlur={() => { window.setTimeout(() => setSearchOpen(false), 120); }}
                onKeyDown={event => {
                  if (event.key === 'Enter' && query.trim() && searchResults[0]) {
                    event.preventDefault();
                    navigate(searchResults[0].route);
                  }
                  if (event.key === 'Escape') { setQuery(''); setSearchOpen(false); event.currentTarget.blur(); }
                }}
                placeholder='搜索功能 / 页面'
                aria-label='搜索功能页面'
                aria-expanded={searchOpen && Boolean(query.trim())}
                aria-controls='nav-search-results'
              />
              {query && <button type='button' className='search-clear' aria-label='清空搜索' onClick={() => { setQuery(''); setSearchOpen(false); }}><X size={14} /></button>}
              {searchOpen && query.trim() && (
                <div className='nav-search-menu' id='nav-search-results'>
                  {searchResults.length > 0 ? searchResults.map(item => {
                    const Icon = item.icon;
                    return (
                      <button key={item.route} type='button' className='nav-search-result' onMouseDown={event => event.preventDefault()} onClick={() => navigate(item.route)}>
                        <Icon size={16} />
                        <span className='search-result-copy'><strong>{item.label}</strong><small>{item.hint}</small></span>
                        <ChevronRight size={14} />
                      </button>
                    );
                  }) : <p className='nav-search-empty'>没有匹配的页面</p>}
                </div>
              )}
            </div>
            <button
              type='button'
              className='icon-button page-guide-button'
              aria-label='打开当前页面功能导览'
              title='页面功能导览'
              onClick={() => setGuideRoute(route)}
            >
              <HelpCircle size={18} />
            </button>
            <span className='sandbox-badge'><ShieldCheck size={14} /><span>模拟环境 · 合成数据</span></span>
            <button className='reminder-entry' type='button' onClick={()=>navigate(familyAlertCount?'family':state.notifications?.some(n=>n.kind==='green_budget')?'tasks':'mandates')} aria-label={`查看站内提醒，${familyAlertCount+(state.notifications?.length??0)}条`}>提醒 {familyAlertCount+(state.notifications?.length??0)}</button>
            <button type='button' className='user-chip' title={`${displayName} · 打开账号设置`} aria-label='打开账号设置' onClick={() => navigate('settings')}>
              <span className='user-avatar'>{initial}</span>
              <span className='user-name'>{displayName}</span>
            </button>
          </div>
        </header>

        <div className='context-row'>
          <p className='context-description'>{page.description}</p>
          <div className='context-status'>
            {state.pending && <span className='context-pending' title={state.pending.question}>待补充：{state.pending.question}</span>}
          </div>
        </div>

        <main className='workspace workspace--wide'>
          {session?.persistence==='ephemeral' && <p className='hosted-preview-notice' role='note'>在线免费试用 · 全部为合成数据，服务休眠或更新后可能重置；请保存重要反馈。每个浏览器独立体验。</p>}
          <section className='page-panel' aria-label={page.title}>
            {['transfers', 'funding', 'cards', 'wealth'].includes(route)
              ? <AccountSubpageHeader route={route} state={state} onBack={() => navigate('accounts')} />
              : <PageSubnavigation route={route} onNavigate={navigate} />}
            {renderPage()}
          </section>
        </main>

        <MobileNavigation route={route} onNavigate={navigate} onMore={() => setDrawerOpen(true)} moreOpen={drawerOpen} />
      </div>

      {toast && (
        <div className={`toast toast--${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
          <ToastIcon size={18} />
          <span>{toast.message}</span>
          <button type='button' className='toast-close' aria-label='关闭提示' onClick={dismissToast}><X size={14} /></button>
        </div>
      )}

      <dialog ref={dialogRef} className='plan-dialog' aria-labelledby='plan-dialog-title' aria-modal='true' onClose={handleDialogClose} onCancel={event => {if(planActionDisabled)event.preventDefault();}}>
        {activePlan && (
          <div className='plan-dialog-body'>
            <header className='plan-dialog-head'>
              <div className='plan-dialog-heading'>
                <span className={`status-pill status-pill--${planStatusTone(activeStatus)}`}>{planStatusLabel(activeStatus)}</span>
                <h2 id='plan-dialog-title'>{activePlan.title}</h2>
                <p className='plan-dialog-meta'>创建于 {formatDateTime(activePlan.createdAt)} · 独立银行模拟环境</p>
              </div>
              <button type='button' className='icon-button' aria-label='关闭计划对话框' onClick={closePlanDialog}><X size={18} /></button>
            </header>

            {activeStatus === 'executed' ? (
              activeReceipt ? <ReceiptBlock receipt={activeReceipt} /> : <div className='plan-empty'>服务端已标记执行，但未返回凭证。请刷新“预约与凭证”核对，不显示未经服务端确认的凭证。</div>
            ) : editMode ? (
              <section className='plan-section' aria-labelledby='plan-edit-title'>
                <h3 id='plan-edit-title'>修改后重新生成</h3>
                <p className='plan-summary'>原计划已取消或失效，不会执行。请编辑完整请求，生成新的待确认计划；不会自动确认，也不会自动转账。</p>
                <label className='sr-only' htmlFor='plan-edit-request'>完整请求</label>
                <div className='composer-box'>
                  <textarea
                    id='plan-edit-request'
                    ref={editRef}
                    className='plan-edit-input'
                    value={editText}
                    onChange={event => setEditText(event.target.value)}
                    rows={5}
                    maxLength={2000}
                    placeholder='请完整描述要重新办理的事项'
                  />
                  <div className='composer-footer'>
                    <span className='composer-hint'>{editText.length}/2000</span>
                  </div>
                </div>
                {renderPlanIssues()}
                <div className='plan-actions'>
                  <button type='button' className='button button--ghost' onClick={() => { setEditMode(false); setPlanError(null); setPlanRecovery(null); }} disabled={editBusy}>返回计划</button>
                  <button type='button' className='button button--primary' onClick={() => void handleGenerate()} disabled={editBusy || !editText.trim()}>
                    {editBusy ? <Loader2 size={16} className='spin' /> : <Repeat size={16} />}
                    {editBusy ? '生成中…' : '生成新方案'}
                  </button>
                </div>
              </section>
            ) : (
              <>
                <p className='plan-summary'>{activePlan.summary}</p>
                {activePlan.impactCents !== 0 && <div className='plan-impact'>预计影响金额 <strong>{money(activePlan.impactCents)}</strong></div>}
                {activeStatus === 'pending' ? (
                  <>
                    <section className='plan-section'>
                      <h3>执行步骤</h3>
                      <ol className='plan-steps'>
                        {activePlan.steps.map((step, index) => (
                          <li className='plan-step' key={`${step.tool}-${index}`}>
                            <div className='plan-step-head'>
                              <span className='plan-step-index'>{index + 1}</span>
                              <div><strong>{step.label}</strong></div>
                            </div>
                            {Object.keys(step.params).length > 0 ? (
                              <dl className='plan-params'>
                                {Object.entries(step.params).filter(([key, value]) => value !== null && value !== undefined && value !== '' && !HIDDEN_PARAM_KEYS.has(key) && !(key === 'recipient' && step.params.recipientName)).map(([key, value]) => (
                                  <div key={key}><dt>{PARAM_LABELS[key] ?? key}</dt><dd>{formatPlanParam(key, value)}</dd></div>
                                ))}
                              </dl>
                            ) : <p className='plan-param-empty'>无额外参数</p>}
                          </li>
                        ))}
                      </ol>
                    </section>
                    <section className='plan-warnings'>
                      <h3>风险与提醒</h3>
                      {activePlan.warnings.length > 0 ? <ul>{activePlan.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : <p>无额外警告；执行前仍会重新校验余额、卡片状态与计划有效期。</p>}
                    </section>
                    <p className={`plan-expiry ${expired ? 'plan-expiry--expired' : ''}`}>
                      {expired && <AlertCircle size={14} aria-hidden='true' />}
                      <span>计划有效至 {formatDateTime(activePlan.expiresAt)}</span>
                      {activePlan.demoExpiresAt && <span> · 演示时限 {formatDateTime(activePlan.demoExpiresAt)}</span>}
                      {expired && <strong>已超过有效期，无法确认执行</strong>}
                    </p>
                    {renderPlanIssues()}
                    <div className='plan-actions'>
                      <button type='button' className='button button--ghost' onClick={closePlanDialog} disabled={planActionDisabled}>关闭</button>
                      <button type='button' className='button button--ghost' onClick={() => void requestEdit()} disabled={planActionDisabled}>
                        {cancelForEditBusy ? <Loader2 size={16} className='spin' /> : <Repeat size={16} />}
                        {cancelForEditBusy ? '取消原计划中…' : '修改方案'}
                      </button>
                      <button type='button' className='button button--danger' onClick={() => void handleCancelPlan()} disabled={planActionDisabled}>
                        {cancelBusy ? <Loader2 size={16} className='spin' /> : <X size={16} />}
                        {cancelBusy ? '取消中…' : '取消计划'}
                      </button>
                    </div>
                    <TransactionGate key={activePlan.id} plan={activePlan} risk={activePlan.operationRisk} disabled={confirmBusy || cancelBusy || cancelForEditBusy || editBusy || expired} onVerified={handleConfirm} onVerifying={setSecurityBusy} />
                  </>
                ) : (
                  <>
                    <div className={`plan-state-note plan-state-note--${planStatusTone(activeStatus)}`}>
                      <AlertCircle size={18} /><p>{planStatusNote(activeStatus)}</p>
                    </div>
                    {renderPlanIssues()}
                    <div className='plan-actions'>
                      <button type='button' className='button button--ghost' onClick={closePlanDialog} disabled={planActionDisabled}>关闭</button>
                      {canEditPlan ? (
                        <button type='button' className='button button--primary' onClick={() => void requestEdit()} disabled={planActionDisabled}>
                          {cancelForEditBusy ? <Loader2 size={16} className='spin' /> : <Repeat size={16} />}
                          {cancelForEditBusy ? '取消原计划中…' : '修改后重新生成'}
                        </button>
                      ) : (
                        <button type='button' className='button button--ghost' onClick={() => void syncState()} disabled={planActionDisabled}>
                          <RotateCcw size={16} />刷新状态
                        </button>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </dialog>

      {guideRoute && <PageGuide route={guideRoute} onClose={closeGuide} />}

      {showOperationPrompt && !guideRoute && (
        <div className='guide-backdrop' onMouseDown={event => { if (event.target === event.currentTarget) dismissOperationPrompt(); }}>
          <section className='operation-prompt' role='dialog' aria-modal='true' aria-labelledby='operation-prompt-title'>
            <span className='operation-prompt-icon'><KeyRound size={22} /></span>
            <div>
              <span className='settings-kicker'>首次提醒</span>
              <h2 id='operation-prompt-title'>先设置一个操作码</h2>
            </div>
            <p>
              家庭邀请、加入家庭和管理关系会经常使用。把它与交易密码分开，日常操作更方便，也不用反复输入资金核验密码。
            </p>
            <div className='operation-prompt-note'>
              <ShieldCheck size={16} />
              <span>6 位数字，仅用于非资金设置；转账等资金操作仍使用交易密码和设备验证。</span>
            </div>
            <div className='operation-prompt-actions'>
              <button type='button' className='button button--ghost' onClick={dismissOperationPrompt}>今天稍后</button>
              <button
                type='button'
                className='button button--primary'
                onClick={() => {
                  setShowOperationPrompt(false);
                  navigate('settings');
                }}
              >
                去账号设置
              </button>
            </div>
          </section>
        </div>
      )}
    </div></>
  );
}

function ReceiptBlock({ receipt }: { receipt: Receipt }) {
  return (
    <section className='receipt-card' aria-label='服务端执行凭证'>
      <div className='receipt-head'>
        <div><span className='receipt-kicker'>服务端执行凭证</span><h4>{receipt.title}</h4></div>
        <code className='receipt-id'>{receipt.id}</code>
      </div>
      <p className='receipt-summary'>{receipt.summary}</p>
      <dl className='receipt-facts'>
        <div><dt>执行时间</dt><dd>{formatDateTime(receipt.executedAt)}</dd></div>
        <div><dt>执行后余额</dt><dd>{money(receipt.balanceCents)}</dd></div>
        <div className='receipt-transactions'><dt>关联流水</dt><dd>{receipt.transactionIds.length > 0 ? <ul>{receipt.transactionIds.map(id => <li key={id}><code>{id}</code></li>)}</ul> : '无'}</dd></div>
      </dl>
      {receipt.details.length > 0 && (
        <div className='receipt-details'>
          <h5>明细</h5>
          <ul>{receipt.details.map((detail, index) => <li key={index}>{formatUnknown(detail)}</li>)}</ul>
        </div>
      )}
    </section>
  );
}
