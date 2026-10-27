import { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, ChevronRight, Loader2, MessageCircle, RotateCcw, Send, Sparkles } from 'lucide-react';
import { ApiError, money } from '../api';
import type { PageProps, Recovery } from '../types';
import './Assistant.css';
import { AgentTaskCard } from './AgentTaskCard';
import { AssistantWaiting } from './AssistantWaiting';
import { AgentQuestions } from './AgentQuestions';

interface AssistantProps extends PageProps {
  compact?: boolean;
  conversation?: boolean;
  queuedMessage?: { id: string; text: string } | null;
  consumeQueuedMessage?: (id: string) => void;
}
type RecoveryAction = Recovery['actions'][number];

const EMPTY_EXAMPLES = [
  { tag: '目标', text: '我今年要攒十万块' },
  { tag: '转账', text: '给林悦转520元' },
  { tag: '账单', text: '分析本月账单' },
  { tag: '生日', text: '10月25日是爱人生日，提前2天订购鲜花和蛋糕，预留1000元' },
];

const QUICK_FULL = ['我今年要攒十万块', '帮我梳理本月开销，看看能怎么省钱', '每月检查订阅，涨价提醒我，别动云盘', '查看任务进度'];
const QUICK_COMPACT = ['我今年要攒十万块', '分析本月账单', '比较理财产品'];

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '发送失败，请稍后重试';
}

function displayMessage(text:string):string {
  if(!text.startsWith('绿色选择咨询：'))return text;
  try{
    const data=JSON.parse(text.slice('绿色选择咨询：'.length)),p=data.input;
    const label=data.sample?'（含示例输入）':'';
    if(data.kind==='commute')return `帮我再看看这个通勤选择${label}：原方案每天${money(p.originalDailyCents)}，替代方案${money(p.alternativeDailyCents)}，每月${p.days}个可替代日，每天多${p.extraMinutes}分钟${p.maxExtraMinutes!==undefined?`，可接受上限${p.maxExtraMinutes}分钟`:''}。只讨论方案，先不办理。`;
    if(data.kind==='appliance'&&Array.isArray(p.candidates))return `帮我再看看这次家电选择${label}：旧机每年${p.currentAnnualKwh}度电，电价${new Intl.NumberFormat('zh-CN',{maximumFractionDigits:4}).format(p.electricityPriceCents/100)}元/度，按${p.years}年比较；${p.replacementRequired?'旧机已不能继续使用':'旧机仍可用'}。${p.candidates.map((c:{name:string;priceCents:number;annualKwh:number})=>`${c.name}到手价${money(c.priceCents)}，每年${c.annualKwh}度电`).join('；')}${p.budgetCents!==undefined?`。购机预算${money(p.budgetCents)}`:''}。只讨论方案，先不办理。`;
  }catch{/* Older or malformed messages retain their original content. */}
  return text;
}

function formatClock(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
}

function formatTrace(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    try {
      const text = JSON.stringify(value, null, 2);
      return text ?? String(value);
    } catch {
      return '[无法显示的执行轨迹]';
    }
  }
  return String(value);
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'rule': return '本地校验';
    case 'llm': return 'DeepSeek 理解';
    case 'llm_fallback': return '模型回退';
    case 'fallback': return '规则回退';
    default: return source;
  }
}

function sourceTone(source: string): string {
  if (source === 'rule') return 'rule';
  if (source === 'llm') return 'llm';
  if (source === 'llm_fallback' || source === 'fallback') return 'fallback';
  return 'unknown';
}

function sourceInfo(sources?: Record<string, unknown>): { label: string; count: number } | null {
  if (!sources) return null;
  if (Array.isArray(sources.transactionIds) && sources.transactionIds.length) return { label: '流水来源', count: sources.transactionIds.length };
  const keys = Object.keys(sources).filter(key => key !== 'asOf' && key !== 'filter');
  if (keys.length === 0) return null;
  const arrayKey = keys.find(key => Array.isArray(sources[key]) && sources[key].length > 0);
  if (arrayKey) {
    const value = sources[arrayKey];
    return { label: '来源条目', count: Array.isArray(value) ? value.length : 0 };
  }
  const fields = keys.filter(key => !Array.isArray(sources[key]));
  return fields.length ? { label: '来源字段', count: fields.length } : null;
}

function candidateInfo(candidate: unknown, index: number): { label: string; detail?: string; reply: string } | null {
  if (typeof candidate === 'string') {
    const value = candidate.trim();
    return value ? { label: value, reply: value } : null;
  }
  if (typeof candidate === 'number') return { label: String(candidate), reply: String(candidate) };
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const record = candidate as Record<string, unknown>;
  const pick = (keys: string[]) => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  };
  const name = pick(['name', 'contactName', 'title', 'label', 'productName', 'subscriptionName']);
  const phone = pick(['phone', 'phoneNumber', 'mobile']);
  const id = pick(['id', 'contactId', 'userId']);
  const reply = phone || id;
  if (!reply) return null;
  const label = name || phone || id || `候选 ${index + 1}`;
  const details: string[] = [];
  if (phone && phone !== label) details.push(`手机尾号 ${phone.slice(-4)}`);
  const last4 = pick(['last4']);
  if (last4) details.push(`尾号 ${last4}`);
  const note = pick(['note']);
  if (note) details.push(note);
  return { label, detail: details.length ? details.join(' · ') : undefined, reply };
}

export function Assistant({ state, send, busy, openPlan, refresh, navigate, compact = false, conversation = false, queuedMessage, consumeQueuedMessage }: AssistantProps) {
  const [draft, setDraft] = useState('');
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<'business' | 'model' | 'unknown' | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const sendingRef = useRef(false);
  const consumedMessageId = useRef<string | null>(null);
  const initial = Array.from(state.profile.name.trim())[0] ?? '我';
  const initialMessages = useRef(new Set(state.messages.map(message => message.id)));
  // Continue the same task across days; the overview keeps a short history.
  const showGreeting = conversation && state.messages.length === 0 && !pendingText;
  const messages = conversation ? state.messages.slice(-20) : state.messages;
  const currentAgentMessageId = [...state.messages].reverse().find(message => message.role === 'assistant')?.id;
  const messageCount = messages.length;
  const quickPrompts = compact ? QUICK_COMPACT : QUICK_FULL;
  const pendingCandidates = state.pending?.candidates ?? [];
  const inlineQuestions = Boolean([...state.messages].reverse().find(message => message.role === 'assistant')?.agent?.clarifications?.length);

  useEffect(() => {
    if (!queuedMessage || busy || consumedMessageId.current === queuedMessage.id) return;
    consumedMessageId.current = queuedMessage.id;
    consumeQueuedMessage?.(queuedMessage.id);
    void submit(queuedMessage.text);
  }, [queuedMessage, busy, consumeQueuedMessage]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const latest=state.messages[state.messages.length-1];
    const rows=element.querySelectorAll<HTMLElement>('.chat-row--assistant');
    const lastRow=rows[rows.length-1];
    if(!busy && latest?.agent && lastRow)element.scrollTop+=lastRow.getBoundingClientRect().top-element.getBoundingClientRect().top;
    else element.scrollTop=element.scrollHeight;
  }, [messageCount, busy, pendingText]);

  async function runRefresh() {
    try {
      await refresh();
      setError(null);
      setErrorKind(null);
    } catch (refreshError) {
      setError(errorMessage(refreshError));
      setErrorKind('unknown');
    }
  }

  async function submit(value: string) {
    const text = value.trim();
    if (!text || busy || sendingRef.current) return false;
    sendingRef.current = true;
    setDraft('');
    setPendingText(text);
    setError(null);
    setErrorKind(null);
    try {
      await send(text);
      setError(null);
      setErrorKind(null);
      return true;
    } catch (sendError) {
      const business = sendError instanceof ApiError && sendError.status >= 400 && sendError.status < 500;
      setDraft(text);
      setError(errorMessage(sendError));
      setErrorKind(sendError instanceof ApiError && sendError.code.startsWith('MODEL_') ? 'model' : business ? 'business' : 'unknown');
      return false;
    } finally {
      sendingRef.current = false;
      setPendingText(null);
      inputRef.current?.focus();
    }
  }

  async function handleRecovery(action: RecoveryAction, recoveryDraft?: string) {
    if (action.kind === 'edit') {
      setDraft(recoveryDraft ?? '');
      setError(null);
      setErrorKind(null);
      inputRef.current?.focus();
      return;
    }
    if (action.kind === 'refresh') {
      await runRefresh();
      return;
    }
    if (action.kind === 'navigate' && action.route && navigate) {
      navigate(action.route);
    }
  }

  return (
    <div className={`assistant assistant--surface ${compact ? 'assistant--compact' : ''} ${conversation ? 'assistant--conversation' : ''}`} aria-busy={busy}>
      <div className='assistant-output'>
        <header className='assistant-head'>
          <div className='assistant-identity'>
            <span className='assistant-orb' aria-hidden='true'><Sparkles size={17} /></span>
            <div><h2>小苔助手</h2><p>{conversation ? '说出目标，一起安排下一步' : compact ? '理解需求，核对方案' : '理解目标 · 规划任务 · 确认办理 · 跟踪结果'}</p></div>
          </div>
          {conversation && <div className='conversation-tools'>
            <button type='button' onClick={() => void runRefresh()} disabled={busy} aria-label='刷新对话'><RotateCcw size={14} /></button>
            {navigate && <button type='button' onClick={() => navigate('assistant')}>全部对话 <ChevronRight size={13} /></button>}
          </div>}
        </header>

        {state.pending && !inlineQuestions && (
          <div className='assistant-pending' role='status'>
            <strong>需要补充</strong>
            {state.pending.questions?.length ? <AgentQuestions key={JSON.stringify(state.pending.questions)} questions={state.pending.questions} disabled={busy} onSend={submit} /> : <p>{state.pending.question}</p>}
            {!state.pending.questions?.length && pendingCandidates.length > 0 && (
              <div className='assistant-examples' aria-label='候选选择'>
                {pendingCandidates.map((candidate, index) => {
                  const info = candidateInfo(candidate, index);
                  if (!info) return null;
                  return (
                    <button key={`${info.reply}-${index}`} type='button' className='assistant-example' onClick={() => void submit(info.reply)} disabled={busy}>
                      <span className='example-tag'>候选</span>
                      <span className='example-text'><strong>{info.label}</strong>{info.detail ? ` · ${info.detail}` : ''}</span>
                      <ChevronRight size={14} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {showGreeting ? (
          <p className='conversation-greeting' role='status'>{state.profile.name}你好，今日业务你想从哪里开始？</p>
        ) : messageCount === 0 && !pendingText ? (
          <div className='assistant-empty'>
            <span className='assistant-empty-icon' aria-hidden='true'><MessageCircle size={22} /></span>
            <h3>今天想办什么？</h3>
            <p>存钱目标、开销梳理或一笔转账，把想做的事交给小苔。</p>
            <div className='assistant-examples'>
              {EMPTY_EXAMPLES.map(example => (
                <button key={example.text} type='button' className='assistant-example' onClick={() => void submit(example.text)} disabled={busy}>
                  <span className='example-tag'>{example.tag}</span>
                  <span className='example-text'>{example.text}</span>
                  <ChevronRight size={14} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className='assistant-messages' ref={scrollRef} role='log' aria-live='polite' aria-relevant='additions'>
            {messages.map(message => {
              const plan = message.planId ? state.plans.find(item => item.id === message.planId) : undefined;
              const sources = sourceInfo(message.sources);
              const trace = Array.isArray(message.trace) ? message.trace : [];
              const time = formatClock(message.at);
              return (
                <article key={message.id} className={`chat-row chat-row--${message.role} ${initialMessages.current.has(message.id) ? '' : 'chat-row--enter'}`}>
                  <div className={`chat-avatar chat-avatar--${message.role}`} aria-hidden='true'>
                    {message.role === 'assistant' ? <Sparkles size={15} /> : initial}
                  </div>
                  <div className='chat-bubble'>
                    {(message.role==='user'||!message.agent||message.agent.kind==='savings')&&<p className='chat-text'>{message.role==='user'?displayMessage(message.text):message.text}</p>}
                    {message.role==='assistant' && message.agent && <AgentTaskCard view={message.agent} answer={message.text} plan={plan} onOpenPlan={openPlan} busy={busy} onSend={submit} onNavigate={navigate} isCurrent={message.id===currentAgentMessageId && (!plan || plan.status==='pending')} />}
                    <div className='chat-meta'>
                      {message.intentSource && <span className={`source-chip source-chip--${sourceTone(message.intentSource)}`}>{sourceLabel(message.intentSource)}</span>}
                      {sources && <span className='source-chip source-chip--count'>{sources.label} {sources.count}</span>}
                      {time && <time className='chat-time' dateTime={message.at}>{time}</time>}
                    </div>
                    {message.fallbackReason && <p className='fallback-reason'>回退原因：{message.fallbackReason}</p>}
                    {plan && !message.agent && <><button type='button' className='view-plan' onClick={() => openPlan(plan)}>查看计划 <ChevronRight size={14} /></button><span className='source-chip'>{({pending:'待确认',cancelled:'已取消',expired:'已过期',executed:'已执行',failed:'执行失败'} as Record<string,string>)[plan.status]??plan.status}</span></>}
                    {message.planId && !plan && <span className='missing-plan'>关联计划已不在当前模拟环境</span>}
                    {message.recovery && (
                      <div className='assistant-recovery' role='group' aria-label={message.recovery.title}>
                        <p>{message.recovery.title}</p>
                        <div className='assistant-quick'>
                          {message.recovery.actions.map((action, index) => {
                            if (action.kind === 'navigate' && (!action.route || !navigate)) return null;
                            return (
                              <button key={`${action.kind}-${index}`} type='button' onClick={() => void handleRecovery(action, message.recovery?.draft)} disabled={busy}>{action.label}</button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {trace.length > 0 && (
                      <details className='trace-box'>
                        <summary>执行轨迹 · {trace.length} 条</summary>
                        <ol>{trace.map((item, index) => <li key={index}><pre>{formatTrace(item)}</pre></li>)}</ol>
                      </details>
                    )}
                  </div>
                </article>
              );
            })}
            {pendingText && <>
              {state.messages[state.messages.length - 1]?.text !== pendingText && <article className='chat-row chat-row--user'><div className='chat-avatar chat-avatar--user' aria-hidden='true'>{initial}</div><div className='chat-bubble'><p className='chat-text'>{displayMessage(pendingText)}</p></div></article>}
              <article className='chat-row chat-row--assistant chat-row--waiting'><AssistantWaiting /></article>
            </>}
          </div>
        )}

        {error && (
          <div className='assistant-error' role='alert'>
            <AlertCircle size={18} />
            <div className='assistant-error-copy'>
              <strong>{errorKind === 'model' ? '暂时没有收到 AI 结果' : errorKind === 'business' ? '请求需要调整' : '结果待核对'}</strong>
              <p>{error}</p>
              {errorKind === 'business' && <p className='assistant-footnote'>请修改需要调整的内容后重新发送。</p>}
              {errorKind === 'model' && <p className='assistant-footnote'>输入和已填条件已保留，本轮没有生成新办理方案。</p>}
              {errorKind === 'unknown' && <p className='assistant-footnote'>网络结果未知，请先刷新并到预约与凭证核对，确认未执行后再手动重新发送。</p>}
            </div>
            {errorKind === 'model' && <button type='button' className='assistant-retry' onClick={() => void submit(draft)} disabled={busy || !draft.trim()}><RotateCcw size={14} />重新发送</button>}
            {errorKind === 'unknown' && (
              <div className='assistant-error-actions'>
                <button type='button' className='assistant-retry' onClick={() => void runRefresh()} disabled={busy}><RotateCcw size={14} />刷新核对</button>
                {navigate && <button type='button' className='assistant-retry' onClick={() => navigate('tasks')} disabled={busy}>预约与凭证</button>}
              </div>
            )}
          </div>
        )}

        {!conversation && messageCount > 0 && (
          <details className='assistant-quick-menu'><summary>换个任务 · 快捷建议</summary><div className='assistant-quick' aria-label='快捷问题'>
            {quickPrompts.map(prompt => (
              <button key={prompt} type='button' onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); void submit(prompt); }} disabled={busy}>{prompt}</button>
            ))}
          </div></details>
        )}
      </div>

      <form className='assistant-composer' onSubmit={event => { event.preventDefault(); void submit(draft); }}>
        <label className='sr-only' htmlFor={inputId}>给小苔助手发消息</label>
        <div className='composer-box'>
          <textarea
            id={inputId}
            ref={inputRef}
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                event.preventDefault();
                void submit(draft);
              }
            }}
            rows={2}
            maxLength={2000}
            placeholder='例如：我今年要攒十万块，帮我规划一下'
          />
          <div className='composer-footer'>
            {draft.length > 1800 && <span className='composer-hint'>{draft.length}/2000</span>}
            <button className='assistant-send' type='submit' disabled={busy || !draft.trim()}>
              {busy ? <Loader2 size={16} className='spin' /> : <Send size={16} />}
              <span>{busy ? '处理中' : '发送'}</span>
            </button>
          </div>
        </div>
      </form>
      {conversation && <div className='conversation-suggestions' aria-label='快捷建议'>
        {QUICK_COMPACT.map(prompt => <button key={prompt} type='button' disabled={busy} onClick={() => { setDraft(prompt); inputRef.current?.focus(); }}>{prompt}<ChevronRight size={12} /></button>)}
      </div>}
    </div>
  );
}

export default Assistant;
