import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Leaf, Loader2, Sparkles, Target } from 'lucide-react';
import { money, request } from '../api';
import './GreenChoices.css';
import type {
  ApplianceCandidateInput,
  ApplianceInput,
  CommuteInput,
  GreenDecisionResult,
  TransportMode,
} from '../green-tools-types';

export interface GreenChoicesProps {
  send: (text: string) => Promise<void>;
  busy: boolean;
  onGoal: () => void;
  draftKey: string;
}

type ToolTab = 'appliance' | 'commute';

type Payload =
  | { kind: 'appliance'; input: ApplianceInput }
  | { kind: 'commute'; input: CommuteInput };

interface Report {
  payload: Payload;
  data: GreenDecisionResult;
  isSample: boolean;
}

interface QuoteForm {
  name: string;
  price: string;
  kwh: string;
}

interface ApplianceForm {
  currentKwh: string;
  tariff: string;
  years: string;
  budget: string;
  replacementRequired: boolean;
  quotes: QuoteForm[];
}

interface CommuteForm {
  dailyKm:string;
  originalMode:string;
  alternativeMode:string;
  originalMinutes:string;
  alternativeMinutes:string;
  original: string;
  alternative: string;
  days: string;
  extraMinutes: string;
  maxExtraMinutes: string;
}

type Build<T> = { ok: true; input: T } | { ok: false; error: string };
interface Draft {tab:ToolTab;appliance:ApplianceForm;commute:CommuteForm;samples:Record<ToolTab,boolean>}
function readDraft(key:string):Draft|null {
  try{
    const raw=sessionStorage.getItem(key);if(!raw||raw.length>8192)return null;
    const d=JSON.parse(raw),a=d.appliance,c=d.commute;
    const text=(v:unknown)=>typeof v==='string'&&v.length<=100;
    if(!['appliance','commute'].includes(d.tab)||!a||!c||!d.samples||typeof d.samples.appliance!=='boolean'||typeof d.samples.commute!=='boolean')return null;
    if(!['currentKwh','tariff','years','budget'].every(k=>text(a[k]))||typeof a.replacementRequired!=='boolean'||!Array.isArray(a.quotes)||a.quotes.length<1||a.quotes.length>2||!a.quotes.every((q:QuoteForm)=>q&&text(q.name)&&text(q.price)&&text(q.kwh)))return null;
    if(!['original','alternative','days','extraMinutes','maxExtraMinutes'].every(k=>text(c[k])))return null;
    for(const k of ['dailyKm','originalMode','alternativeMode','originalMinutes','alternativeMinutes'])if(c[k]!==undefined&&!text(c[k]))return null;
    return {...d,commute:{...initialCommuteForm(),...c}} as Draft;
  }catch{return null;}
}

const DEC2 = /^\d+(\.\d{1,2})?$/;
const INT = /^\d+$/;

function blankQuote(): QuoteForm {
  return { name: '', price: '', kwh: '' };
}

function initialApplianceForm(): ApplianceForm {
  return { currentKwh: '', tariff: '', years: '5', budget: '', replacementRequired: false, quotes: [blankQuote()] };
}

function initialCommuteForm(): CommuteForm {
  return { original: '', alternative: '', days: '20', extraMinutes: '', maxExtraMinutes: '', dailyKm:'',originalMode:'urban',alternativeMode:'metro',originalMinutes:'',alternativeMinutes:'' };
}

function sampleApplianceForm(): ApplianceForm {
  return {
    currentKwh: '600',
    tariff: '0.6',
    years: '5',
    budget: '',
    replacementRequired: false,
    quotes: [{ name: '', price: '2400', kwh: '300' }],
  };
}

function sampleCommuteForm(): CommuteForm {
  return { original: '8', alternative: '3.5', days: '20', extraMinutes: '12', maxExtraMinutes: '20',dailyKm:'10',originalMode:'urban',alternativeMode:'metro',originalMinutes:'35',alternativeMinutes:'47' };
}

/** 元字符串（最多两位小数）转整数分，避免浮点误差 */
function yuanToCents(text: string): number {
  const [intPart, fracPart = ''] = text.split('.');
  return Number(intPart) * 100 + Number(`${fracPart}00`.slice(0, 2));
}

function buildAppliance(form: ApplianceForm): Build<ApplianceInput> {
  const kwhText = form.currentKwh.trim();
  if (!kwhText) return { ok: false, error: '请填写旧机每年耗电（kWh）' };
  if (!DEC2.test(kwhText)) return { ok: false, error: '旧机耗电需为数字，最多两位小数' };
  const currentAnnualKwh = Number(kwhText);
  if (currentAnnualKwh > 100000) return { ok: false, error: '旧机耗电需在 0–100000 kWh 之间' };

  const tariffText = form.tariff.trim();
  if (!tariffText) return { ok: false, error: '请填写电价（元/kWh）' };
  if (!/^\d+(\.\d{1,4})?$/.test(tariffText)) return { ok: false, error: '电价需为数字，最多四位小数' };
  const priceCents = Math.round(Number(tariffText)*10000)/100;
  if (priceCents < 1 || priceCents > 1000) return { ok: false, error: '电价需在 0.01–10 元/kWh 之间' };

  const yearsText = form.years.trim();
  if (!yearsText) return { ok: false, error: '请填写计划使用年数（1–15）' };
  const years = Number(yearsText);
  if (!INT.test(yearsText) || years < 1 || years > 15) {
    return { ok: false, error: '使用年数需为 1–15 的整数' };
  }

  const budgetText = form.budget.trim();
  let budgetCents: number | undefined;
  if (budgetText) {
    if (!DEC2.test(budgetText)) return { ok: false, error: '预算需为数字，最多两位小数' };
    budgetCents = yuanToCents(budgetText);
    if (budgetCents <= 0) return { ok: false, error: '预算需大于 0 元' };
  }

  const candidates: ApplianceCandidateInput[] = [];
  for (let index = 0; index < form.quotes.length; index += 1) {
    const quote = form.quotes[index];
    const label = quote.name.trim() || (index === 0 ? '新机A' : '新机B');

    const quotePriceText = quote.price.trim();
    if (!quotePriceText) return { ok: false, error: `请填写${label}购机价（元）` };
    if (!DEC2.test(quotePriceText)) return { ok: false, error: `${label}购机价需为数字，最多两位小数` };
    const quotePriceCents = yuanToCents(quotePriceText);
    if (quotePriceCents <= 0) return { ok: false, error: `${label}购机价需大于 0 元` };

    const quoteKwhText = quote.kwh.trim();
    if (!quoteKwhText) return { ok: false, error: `请填写${label}每年耗电（kWh）` };
    if (!DEC2.test(quoteKwhText)) return { ok: false, error: `${label}耗电需为数字，最多两位小数` };
    const annualKwh = Number(quoteKwhText);
    if (annualKwh > 100000) return { ok: false, error: `${label}耗电需在 0–100000 kWh 之间` };

    candidates.push({ name: label, priceCents: quotePriceCents, annualKwh });
  }

  const input: ApplianceInput = {
    currentAnnualKwh,
    electricityPriceCents: priceCents,
    years,
    replacementRequired: form.replacementRequired,
    candidates,
  };
  if (budgetCents !== undefined) input.budgetCents = budgetCents;
  return { ok: true, input };
}

function buildCommute(form: CommuteForm): Build<CommuteInput> {
  const originalText = form.original.trim();
  if (!originalText) return { ok: false, error: '请填写原方案每天花费（元）' };
  if (!DEC2.test(originalText)) return { ok: false, error: '原方案花费需为数字，最多两位小数' };

  const alternativeText = form.alternative.trim();
  if (!alternativeText) return { ok: false, error: '请填写新方案每天花费（元）' };
  if (!DEC2.test(alternativeText)) return { ok: false, error: '新方案花费需为数字，最多两位小数' };

  const daysText = form.days.trim();
  if (!daysText) return { ok: false, error: '请填写每月通勤天数（1–31）' };
  const days = Number(daysText);
  if (!INT.test(daysText) || days < 1 || days > 31) {
    return { ok: false, error: '每月天数需为 1–31 的整数' };
  }

  if (![form.originalMinutes,form.alternativeMinutes].every(v=>INT.test(v)&&Number(v)<=240))return {ok:false,error:'请填写原、新方案每天往返耗时，范围0—240分钟。'};
  const originalMinutes=Number(form.originalMinutes),alternativeMinutes=Number(form.alternativeMinutes);
  const extraMinutes=Math.max(0,alternativeMinutes-originalMinutes);
  if(!DEC2.test(form.dailyKm)||Number(form.dailyKm)<=0||Number(form.dailyKm)>500)return {ok:false,error:'请填写每日往返距离，范围0.01—500公里，最多两位小数。'};
  const modes=['urban','electric_bus','metro','walk_cycle'];
  if(!modes.includes(form.originalMode)||!modes.includes(form.alternativeMode))return {ok:false,error:'请选择原、新方案的交通方式。'};

  const maxText = form.maxExtraMinutes.trim();
  let maxExtraMinutes: number | undefined;
  if (maxText) {
    if (!INT.test(maxText)) return { ok: false, error: '可接受的最长时间需为整数分钟（0–240）' };
    const parsed = Number(maxText);
    if (parsed > 240) return { ok: false, error: '可接受的最长时间需在 0–240 分钟之间' };
    maxExtraMinutes = parsed;
  }

  const input: CommuteInput = {
    originalDailyCents: yuanToCents(originalText),
    alternativeDailyCents: yuanToCents(alternativeText),
    days,
    extraMinutes,
    originalMinutes,alternativeMinutes,dailyKm:Number(form.dailyKm),originalMode:form.originalMode as TransportMode,alternativeMode:form.alternativeMode as TransportMode,
  };
  if (maxExtraMinutes !== undefined) input.maxExtraMinutes = maxExtraMinutes;
  return { ok: true, input };
}

export function GreenChoices({ send, busy, onGoal, draftKey }: GreenChoicesProps) {
  const [draft]=useState(()=>readDraft(draftKey));
  const [tab, setTab] = useState<ToolTab>(draft?.tab??'appliance');
  const [appliance, setAppliance] = useState<ApplianceForm>(draft?.appliance??initialApplianceForm);
  const [commute, setCommute] = useState<CommuteForm>(draft?.commute??initialCommuteForm);
  const [report, setReport] = useState<Report | null>(null);
  const [toolOpen,setToolOpen]=useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [samples,setSamples]=useState<Record<ToolTab,boolean>>(draft?.samples??{appliance:false,commute:false});
  const sampleActive=samples[tab];
  const setSampleActive=(value:boolean)=>setSamples(current=>({...current,[tab]:value}));
  const [aiState, setAiState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [aiError, setAiError] = useState<string | null>(null);

  const loadingRef = useRef(false);
  const requestRef = useRef(0);
  const applianceTabRef = useRef<HTMLButtonElement | null>(null);
  const commuteTabRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => () => {
    requestRef.current += 1;
  }, []);
  useEffect(()=>{try{sessionStorage.setItem(draftKey,JSON.stringify({tab,appliance,commute,samples}));}catch{/* The form remains usable when session storage is unavailable. */}},[draftKey,tab,appliance,commute,samples]);

  useEffect(()=>{if(report)requestAnimationFrame(()=>document.getElementById('gc-result-title')?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}));},[report]);

  function markEdited() {
    requestRef.current += 1;
    setReport(null);
    setFailed(null);
    setError(null);
  }

  function patchAppliance(patch: Partial<ApplianceForm>) {
    markEdited();
    setAppliance((prev) => ({ ...prev, ...patch }));
  }

  function patchQuote(index: number, patch: Partial<QuoteForm>) {
    markEdited();
    setAppliance((prev) => ({
      ...prev,
      quotes: prev.quotes.map((quote, i) => (i === index ? { ...quote, ...patch } : quote)),
    }));
  }

  function addQuote() {
    markEdited();
    setAppliance((prev) => (prev.quotes.length >= 2 ? prev : { ...prev, quotes: [...prev.quotes, blankQuote()] }));
  }

  function removeQuote(index: number) {
    markEdited();
    setAppliance((prev) => ({ ...prev, quotes: prev.quotes.filter((_, i) => i !== index) }));
  }

  function patchCommute(patch: Partial<CommuteForm>) {
    markEdited();
    setCommute((prev) => ({ ...prev, ...patch }));
  }

  function switchTab(next: ToolTab) {
    if (next === tab) return;
    markEdited();
    setAiState('idle');
    setAiError(null);
    setTab(next);
  }

  function handleTabKey(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const { key } = event;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return;
    event.preventDefault();
    const next: ToolTab = key === 'Home'
      ? 'appliance'
      : key === 'End'
        ? 'commute'
        : tab === 'appliance' ? 'commute' : 'appliance';
    switchTab(next);
    const target = next === 'appliance' ? applianceTabRef.current : commuteTabRef.current;
    target?.focus();
  }

  function showValidationError(message: string) {
    requestRef.current += 1;
    setReport(null);
    setFailed(null);
    setError(message);
  }

  async function submit(payload: Payload, sampleOverride?:boolean) {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    setFailed(null);
    setAiError(null);
    setAiState('idle');
    const isSample = sampleOverride ?? sampleActive;
    const token = requestRef.current + 1;
    requestRef.current = token;
    setReport(null);
    const path = payload.kind === 'appliance' ? '/green/decisions/appliance' : '/green/decisions/commute';

    try {
      const data = await request<GreenDecisionResult>(path, payload.input);
      if (token !== requestRef.current) return;
      if (!data || data.kind !== payload.kind) {
        setError('返回数据异常，请重试');
        setFailed(payload);
        return;
      }
      setReport({ payload, data, isSample });
    } catch (cause) {
      if (token !== requestRef.current) return;
      const message = cause instanceof Error && cause.message.trim() ? cause.message : '计算失败，请稍后重试';
      setError(message);
      setFailed(payload);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }

  function handleApplianceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const built = buildAppliance(appliance);
    if (!built.ok) {
      showValidationError(built.error);
      return;
    }
    void submit({ kind: 'appliance', input: built.input });
  }

  function handleCommuteSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const built = buildCommute(commute);
    if (!built.ok) {
      showValidationError(built.error);
      return;
    }
    void submit({ kind: 'commute', input: built.input });
  }

  function applySample() {
    requestRef.current += 1;
    setReport(null);
    setFailed(null);
    setError(null);
    if (tab === 'appliance') setAppliance(sampleApplianceForm());
    else setCommute(sampleCommuteForm());
    setSampleActive(true);
  }

  function openTool(next:ToolTab){switchTab(next);setToolOpen(true);}
  function quickCarbonSample(){
    switchTab('appliance');setToolOpen(true);
    const form=sampleApplianceForm();setAppliance(form);setSamples(old=>({...old,appliance:true}));
    const built=buildAppliance(form);if(built.ok)void submit({kind:'appliance',input:built.input},true);
  }

  function resetForm() {
    markEdited();
    setSampleActive(false);
    if (tab === 'appliance') setAppliance(initialApplianceForm());
    else setCommute(initialCommuteForm());
  }

  async function askAi() {
    if (!report || busy || aiState === 'sending') return;
    const text = `绿色选择咨询：${JSON.stringify({ kind: report.payload.kind, input: report.payload.input, sample: report.isSample })}`;
    setAiState('sending');
    setAiError(null);
    try {
      await send(text);
      setAiState('sent');
    } catch {
      setAiState('idle');
      setAiError('发送失败，请再试一次');
    }
  }

  const applianceData = report && report.data.kind === 'appliance' ? report.data : null;
  const commuteData = report && report.data.kind === 'commute' ? report.data : null;
  const replacementRequired = report?.payload.kind === 'appliance' ? report.payload.input.replacementRequired : false;
  const budgetProvided = report?.payload.kind === 'appliance' ? report.payload.input.budgetCents !== undefined : false;
  const commuteInput = report?.payload.kind === 'commute' ? report.payload.input : null;

  return (
    <section className="gc-panel" aria-labelledby="gc-title" aria-busy={loading}>
      <header className="gc-head">
        <p className="gc-eyebrow">
          <Leaf size={13} strokeWidth={2.2} aria-hidden="true" />
          生活选择
        </p>
        <h2 className="gc-title" id="gc-title">绿色方案费用与减排比较</h2>
        <p className="gc-sub">算清花费、耗时和预计碳减排，再决定换不换、怎么走。</p>
      </header>

      {!toolOpen&&<div className="gc-entry-options">
        <button type="button" className="feature-launch" onClick={()=>openTool('appliance')}><span><strong>家电换新与减排比较</strong><small>继续用还是换新？比较总花费与预计减少的碳排放。</small></span><ArrowRight size={20}/></button>
        <button type="button" className="feature-launch" onClick={()=>openTool('commute')}><span><strong>通勤方案与减排比较</strong><small>比较原、新方案的花费、耗时和预计碳减排量。</small></span><ArrowRight size={20}/></button>
        <div className="gc-carbon-intro"><Leaf size={23}/><div><strong>选择绿色方案，预计能减少多少碳排放？</strong><p>用耗电或出行距离算清差别。</p></div></div>
        <button type="button" className="gc-btn-ghost" onClick={quickCarbonSample}>先看减排示例 <ArrowRight size={15}/></button>
      </div>}
      <div className="gc-workbench" hidden={!toolOpen} inert={!toolOpen}>
      <button type="button" className="feature-back" onClick={()=>setToolOpen(false)}><ArrowLeft size={15} aria-hidden="true"/>返回绿色工具</button>
      <div className="gc-tabs" role="tablist" aria-label="绿色选择工具">
        <button
          ref={applianceTabRef}
          type="button"
          role="tab"
          id="gc-tab-appliance"
          className={`gc-tab${tab === 'appliance' ? ' is-active' : ''}`}
          aria-selected={tab === 'appliance'}
          aria-controls="gc-panel-appliance"
          tabIndex={tab === 'appliance' ? 0 : -1}
          onClick={() => switchTab('appliance')}
          onKeyDown={handleTabKey}
        >
          换新值不值
        </button>
        <button
          ref={commuteTabRef}
          type="button"
          role="tab"
          id="gc-tab-commute"
          className={`gc-tab${tab === 'commute' ? ' is-active' : ''}`}
          aria-selected={tab === 'commute'}
          aria-controls="gc-panel-commute"
          tabIndex={tab === 'commute' ? 0 : -1}
          onClick={() => switchTab('commute')}
          onKeyDown={handleTabKey}
        >
          通勤怎么选
        </button>
      </div>

      {report && (
        <section className="gc-result" aria-live="polite">
          <div className="gc-result-head">
            <h3 className="gc-result-title" id="gc-result-title">方案对比与预计减排</h3>
            {report.isSample && <span className="gc-chip">含示例输入 · 请核对</span>}
          </div>
          {applianceData&&<section className="gc-carbon gc-carbon-highlight" aria-label="家电预计碳减排量"><header><Leaf size={21}/><h4>选择新机，预计能减少多少碳排放？</h4></header>{applianceData.options.map((option,i)=><div key={i} className={applianceData.carbon.options[i].annualReductionKg<0?'is-carbon-increase':''}><span>{option.name} · 每年预计{applianceData.carbon.options[i].annualReductionKg>=0?'减少':'增加'}</span><strong>{Math.abs(applianceData.carbon.options[i].annualReductionKg).toFixed(2)} kg CO₂</strong><small>{applianceData.years}年合计预计{applianceData.carbon.options[i].totalReductionKg>=0?'减少':'增加'} {Math.abs(applianceData.carbon.options[i].totalReductionKg).toFixed(2)} kg CO₂ · 仅比较用电阶段</small></div>)}</section>}
          <p className="gc-conclusion">{report.data.conclusion}</p>

          {applianceData && (
            <>
              <div className="gc-cards">
                {!replacementRequired && (
                  <article className={`gc-card${applianceData.recommendation === 'keep' ? ' is-best' : ''}`}>
                    <div className="gc-card-head">
                      <h4>保留旧机</h4>
                      {applianceData.recommendation === 'keep' && <span className="gc-badge">推荐</span>}
                    </div>
                    <dl className="gc-card-rows">
                      <div>
                        <dt>年电费</dt>
                        <dd>{money(applianceData.keep.annualCostCents)}</dd>
                      </div>
                      <div>
                        <dt>{applianceData.years} 年合计</dt>
                        <dd>{money(applianceData.keep.totalCostCents)}</dd>
                      </div>
                      <div><dt>预计年用电排放</dt><dd>{applianceData.carbon.keepAnnualKg.toFixed(2)} kg CO₂</dd></div>
                    </dl>
                  </article>
                )}
                {applianceData.options.map((option, index) => {
                  const best = applianceData.recommendedIndex === index;
                  return (
                    <article key={`${option.name}-${index}`} className={`gc-card${best ? ' is-best' : ''}`}>
                      <div className="gc-card-head">
                        <h4>{option.name}</h4>
                        {best && <span className="gc-badge">推荐</span>}
                        {budgetProvided && !option.withinBudget && <span className="gc-badge gc-badge-warn">超预算</span>}
                      </div>
                      <dl className="gc-card-rows">
                        <div>
                          <dt>购机价</dt>
                          <dd>{money(option.priceCents)}</dd>
                        </div>
                        <div>
                          <dt>年电费</dt>
                          <dd>{money(option.annualCostCents)}</dd>
                        </div>
                        <div>
                          <dt>{applianceData.years} 年合计</dt>
                          <dd>{money(option.totalCostCents)}</dd>
                        </div>
                        <div><dt>预计年用电排放</dt><dd>{applianceData.carbon.options[index].annualKg.toFixed(2)} kg CO₂</dd></div>
                        <div className={`gc-option-carbon${applianceData.carbon.options[index].annualReductionKg<0?' is-increase':''}`}><dt>比旧机每年预计{applianceData.carbon.options[index].annualReductionKg>=0?'减少':'增加'}</dt><dd>{Math.abs(applianceData.carbon.options[index].annualReductionKg).toFixed(2)} kg CO₂</dd></div>
                        <div className="gc-option-carbon"><dt>{applianceData.years}年预计{applianceData.carbon.options[index].totalReductionKg>=0?'减排':'增加排放'}</dt><dd>{Math.abs(applianceData.carbon.options[index].totalReductionKg).toFixed(2)} kg CO₂</dd></div>
                        {option.annualSavingCents > 0 && (
                          <div>
                            <dt>预计年电费差</dt>
                            <dd>{money(option.annualSavingCents)}</dd>
                          </div>
                        )}
                        {!replacementRequired && option.paybackYears !== null && option.paybackYears > 0 && (
                          <div>
                            <dt>仅按电费回本约</dt>
                            <dd>{option.paybackYears.toFixed(1)} 年</dd>
                          </div>
                        )}
                      </dl>
                    </article>
                  );
                })}
              </div>
              {replacementRequired && <p className="gc-note">旧机已不能继续使用，这次只比较新机。</p>}
            </>
          )}

          {commuteData && (
            <>
              <dl className="gc-stats">
                <div>
                  <dt>原方案总花费</dt>
                  <dd>{money(commuteData.originalTotalCents)}</dd>
                </div>
                <div>
                  <dt>新方案总花费</dt>
                  <dd>{money(commuteData.alternativeTotalCents)}</dd>
                </div>
                <div className={commuteData.differenceCents >= 0 ? 'is-good' : 'is-bad'}>
                  <dt>{commuteData.differenceCents >= 0 ? '预计少支出' : '预计多支出'}</dt>
                  <dd>{money(Math.abs(commuteData.differenceCents))}</dd>
                </div>
                <div>
                  <dt>{commuteData.extraTotalMinutes>=0?'预计多花时间':'预计节约时间'}</dt>
                  <dd>{Math.abs(commuteData.extraTotalMinutes)} 分钟</dd>
                </div>
                {commuteData.originalTotalMinutes!==null&&<div><dt>原方案往返总耗时</dt><dd>{commuteData.originalTotalMinutes} 分钟</dd></div>}
                {commuteData.alternativeTotalMinutes!==null&&<div><dt>新方案往返总耗时</dt><dd>{commuteData.alternativeTotalMinutes} 分钟</dd></div>}
              </dl>
              {commuteData.carbon&&<section className={`gc-carbon${commuteData.carbon.reductionKg<0?' is-increase':''}`} aria-label="通勤碳排放估算"><header><Leaf size={18}/><h4>{commuteData.carbon.days}天预计{commuteData.carbon.reductionKg>=0?'减排':'增加排放'}</h4></header><strong>{Math.abs(commuteData.carbon.reductionKg).toFixed(2)} kg CO₂</strong><p>{commuteData.carbon.originalLabel} {commuteData.carbon.originalKg.toFixed(2)} → {commuteData.carbon.alternativeLabel} {commuteData.carbon.alternativeKg.toFixed(2)} kg CO₂</p></section>}
              {!commuteData.fitsTime && (
                <p className="gc-warn">每天多花 {commuteInput?.extraMinutes ?? 0} 分钟，超出你能接受的时间。</p>
              )}
              {commuteData.fitsTime && commuteInput && commuteInput.maxExtraMinutes !== undefined && (
                <p className="gc-note">在你能接受的时间范围内。</p>
              )}
            </>
          )}

          {report.data.carbon&&<details className="gc-details gc-carbon-source"><summary>减排怎么算</summary>
            <p>{report.data.carbon.scope}</p>
            {applianceData&&<p>年用电差 × {applianceData.carbon.factor} kg CO₂/kWh × 使用年数。</p>}
            {commuteData?.carbon&&<p>每日往返 {commuteData.carbon.dailyKm} 公里 × {commuteData.carbon.days} 天 × 排放因子差（{commuteData.carbon.originalFactor.toFixed(4)} − {commuteData.carbon.alternativeFactor.toFixed(4)} kg CO₂/人公里）。</p>}
            <p><a href={report.data.carbon.source.url} target="_blank" rel="noreferrer">{report.data.carbon.source.title}</a> · 情景估算，不是核证减排或碳积分。</p>
          </details>}
          <details className="gc-details">
            <summary>费用计算说明</summary>
            <ul className="gc-assumptions">
              {report.data.assumptions.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </details>

          <button type="button" className="gc-link gc-edit-conditions" onClick={()=>document.getElementById(tab==='appliance'?'gc-panel-appliance':'gc-panel-commute')?.scrollIntoView({block:'start',behavior:'smooth'})}>修改比较条件 ↓</button>
          <div className="gc-result-actions">
            <button type="button" className="gc-btn-primary" onClick={onGoal}>
              <Target size={15} aria-hidden="true" />
              设定小目标
            </button>
            <button
              type="button"
              className="gc-btn-ghost"
              onClick={() => { void askAi(); }}
              disabled={busy || aiState === 'sending'}
            >
              <Sparkles size={15} aria-hidden="true" />
              {aiState === 'sending' ? '发送中' : aiState === 'sent' ? '已发送' : '问问 AI'}
            </button>
          </div>
          {aiError && <p className="gc-error-text">{aiError}</p>}
        </section>
      )}

      <div className="gc-tool-actions"><button type="button" className="gc-link" onClick={applySample}>查看示例</button><button type="button" className="gc-link" onClick={resetForm}>清空</button><span className="gc-hint">按你的报价与用量比较</span></div>
      <form
        id="gc-panel-appliance"
        role="tabpanel"
        aria-labelledby="gc-tab-appliance"
        className="gc-form"
        hidden={tab !== 'appliance'}
        onSubmit={handleApplianceSubmit}
        noValidate
      >
        {sampleActive && tab === 'appliance' && (
          <p className="gc-sample">已填入示例数据，可直接算一算，也可以改成你自己的数字。</p>
        )}

        <div className="gc-field">
          <label className="gc-label" htmlFor="gc-old-kwh">旧机每年耗电</label>
          <div className="gc-input">
            <input
              id="gc-old-kwh"
              className="gc-input-el"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="600"
              value={appliance.currentKwh}
              onChange={(event) => patchAppliance({ currentKwh: event.target.value })}
            />
            <span className="gc-unit">kWh</span>
          </div>
          <p className="gc-hint">填写单台设备的年耗电参考值；每日耗电×365，家里整张电费单不能直接代入。</p>
        </div>

        <div className="gc-grid2">
          <div className="gc-field">
            <label className="gc-label" htmlFor="gc-tariff">电价</label>
            <div className="gc-input">
              <input
                id="gc-tariff"
                className="gc-input-el"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.6"
                value={appliance.tariff}
                onChange={(event) => patchAppliance({ tariff: event.target.value })}
              />
              <span className="gc-unit">元/kWh</span>
            </div>
          </div>
          <div className="gc-field">
            <label className="gc-label" htmlFor="gc-years">计划用几年</label>
            <div className="gc-input">
              <input
                id="gc-years"
                className="gc-input-el"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="5"
                value={appliance.years}
                onChange={(event) => patchAppliance({ years: event.target.value })}
              />
              <span className="gc-unit">年</span>
            </div>
          </div>
        </div>

        <details className="gc-more"><summary>预算与换新条件（选填）</summary><div className="gc-field">
          <label className="gc-label" htmlFor="gc-budget">
            预算
            <span className="gc-optional">选填</span>
          </label>
          <div className="gc-input">
            <input
              id="gc-budget"
              className="gc-input-el"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="例如 3000"
              value={appliance.budget}
              onChange={(event) => patchAppliance({ budget: event.target.value })}
            />
            <span className="gc-unit">元</span>
          </div>
        </div>

        <label className="gc-check" htmlFor="gc-required">
          <input
            id="gc-required"
            type="checkbox"
            checked={appliance.replacementRequired}
            onChange={(event) => patchAppliance({ replacementRequired: event.target.checked })}
          />
          <span>必须换新（旧机已不能继续使用）</span>
        </label>
        </details>

        <h3 className="gc-section-title">新机对比</h3>

        {appliance.quotes.map((quote, index) => {
          const label = quote.name.trim() || (index === 0 ? '新机A' : '新机B');
          return (
            <fieldset className="gc-quote" key={index}>
              <legend className="gc-legend">{label}</legend>
              <details className="gc-more gc-name"><summary>给这台设备起个名字（选填）</summary><div className="gc-field">
                <label className="gc-label" htmlFor={`gc-quote-name-${index}`}>
                  名称
                  <span className="gc-optional">选填</span>
                </label>
                <input
                  id={`gc-quote-name-${index}`}
                  className="gc-input-plain"
                  type="text"
                  autoComplete="off"
                  placeholder={index === 0 ? '新机A' : '新机B'}
                  value={quote.name}
                  onChange={(event) => patchQuote(index, { name: event.target.value })}
                />
              </div></details>
              <div className="gc-grid2">
                <div className="gc-field">
                  <label className="gc-label" htmlFor={`gc-quote-price-${index}`}>购机价</label>
                  <div className="gc-input">
                    <input
                      id={`gc-quote-price-${index}`}
                      className="gc-input-el"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="2400"
                      value={quote.price}
                      onChange={(event) => patchQuote(index, { price: event.target.value })}
                    />
                    <span className="gc-unit">元</span>
                  </div>
                </div>
                <div className="gc-field">
                  <label className="gc-label" htmlFor={`gc-quote-kwh-${index}`}>每年耗电</label>
                  <div className="gc-input">
                    <input
                      id={`gc-quote-kwh-${index}`}
                      className="gc-input-el"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="300"
                      value={quote.kwh}
                      onChange={(event) => patchQuote(index, { kwh: event.target.value })}
                    />
                    <span className="gc-unit">kWh</span>
                  </div>
                </div>
              </div>
              {appliance.quotes.length > 1 && (
                <button type="button" className="gc-link" onClick={() => removeQuote(index)}>移除这一台</button>
              )}
            </fieldset>
          );
        })}

        {appliance.quotes.length < 2 && (
          <button type="button" className="gc-link" onClick={addQuote}>+ 再加一台对比</button>
        )}

        <div className="gc-form-foot">
          <button type="submit" className="gc-btn-primary" disabled={loading}>
            {loading ? (
              <>
                <Loader2 size={15} className="gc-spin" aria-hidden="true" />
                计算中
              </>
            ) : (
              <>
                算一算
                <ArrowRight size={15} aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </form>

      <form
        id="gc-panel-commute"
        role="tabpanel"
        aria-labelledby="gc-tab-commute"
        className="gc-form"
        hidden={tab !== 'commute'}
        onSubmit={handleCommuteSubmit}
        noValidate
      >
        {sampleActive && tab === 'commute' && (
          <p className="gc-sample">已填入示例数据，可直接算一算，也可以改成你自己的数字。</p>
        )}

        <div className="gc-grid2">
          <div className="gc-field">
            <label className="gc-label" htmlFor="gc-commute-original">原方案每天</label>
            <div className="gc-input">
              <input
                id="gc-commute-original"
                className="gc-input-el"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="8"
                value={commute.original}
                onChange={(event) => patchCommute({ original: event.target.value })}
              />
              <span className="gc-unit">元</span>
            </div>
          </div>
          <div className="gc-field">
            <label className="gc-label" htmlFor="gc-commute-alternative">新方案每天</label>
            <div className="gc-input">
              <input
                id="gc-commute-alternative"
                className="gc-input-el"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="3.5"
                value={commute.alternative}
                onChange={(event) => patchCommute({ alternative: event.target.value })}
              />
              <span className="gc-unit">元</span>
            </div>
          </div>
        </div>
        <div className="gc-grid2 gc-carbon-fields">
          <label className="gc-field" htmlFor="gc-original-mode"><span className="gc-label">原方案交通方式</span><select id="gc-original-mode" className="gc-mode-select" value={commute.originalMode} onChange={e=>patchCommute({originalMode:e.target.value})}><option value="urban">城市出行参考</option><option value="electric_bus">纯电动公交</option><option value="metro">地铁</option><option value="walk_cycle">步行或自行车</option></select></label>
          <label className="gc-field" htmlFor="gc-alternative-mode"><span className="gc-label">新方案交通方式</span><select id="gc-alternative-mode" className="gc-mode-select" value={commute.alternativeMode} onChange={e=>patchCommute({alternativeMode:e.target.value})}><option value="urban">城市出行参考</option><option value="electric_bus">纯电动公交</option><option value="metro">地铁</option><option value="walk_cycle">步行或自行车</option></select></label>
        </div>
        <div className="gc-grid2">
          <label className="gc-field" htmlFor="gc-original-minutes"><span className="gc-label">原方案每天往返</span><div className="gc-input"><input id="gc-original-minutes" className="gc-input-el" inputMode="numeric" value={commute.originalMinutes} onChange={e=>patchCommute({originalMinutes:e.target.value})} placeholder="35"/><span className="gc-unit">分钟</span></div></label>
          <label className="gc-field" htmlFor="gc-alternative-minutes"><span className="gc-label">新方案每天往返</span><div className="gc-input"><input id="gc-alternative-minutes" className="gc-input-el" inputMode="numeric" value={commute.alternativeMinutes} onChange={e=>patchCommute({alternativeMinutes:e.target.value})} placeholder="47"/><span className="gc-unit">分钟</span></div></label>
        </div>

        <div className="gc-grid2">
          <div className="gc-field">
            <label className="gc-label" htmlFor="gc-commute-days">每月天数</label>
            <div className="gc-input">
              <input
                id="gc-commute-days"
                className="gc-input-el"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="20"
                value={commute.days}
                onChange={(event) => patchCommute({ days: event.target.value })}
              />
              <span className="gc-unit">天</span>
            </div>
          </div>
          <div className="gc-field">
            <label className="gc-label" htmlFor="gc-commute-km">每天往返距离</label>
            <div className="gc-input"><input id="gc-commute-km" className="gc-input-el" inputMode="decimal" value={commute.dailyKm} onChange={e=>patchCommute({dailyKm:e.target.value})} placeholder="10"/><span className="gc-unit">公里</span></div>
          </div>
        </div>

        <div className="gc-field">
          <label className="gc-label" htmlFor="gc-commute-max">
            最多能接受
            <span className="gc-optional">选填</span>
          </label>
          <div className="gc-input">
            <input
              id="gc-commute-max"
              className="gc-input-el"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="20"
              value={commute.maxExtraMinutes}
              onChange={(event) => patchCommute({ maxExtraMinutes: event.target.value })}
            />
            <span className="gc-unit">分钟</span>
          </div>
          <p className="gc-hint">填了才能判断每天多花的时间是否可接受。</p>
        </div>

        <div className="gc-form-foot">
          <button type="submit" className="gc-btn-primary" disabled={loading}>
            {loading ? (
              <>
                <Loader2 size={15} className="gc-spin" aria-hidden="true" />
                计算中
              </>
            ) : (
              <>
                算一算
                <ArrowRight size={15} aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </form>

      {error && (
        <div className="gc-error" role="alert">
          <AlertCircle size={15} aria-hidden="true" />
          <span>{error}</span>
          {failed && (
            <button type="button" className="gc-link" onClick={() => { void submit(failed); }}>重试</button>
          )}
        </div>
      )}


      </div>
    </section>
  );
}
