import { useId, useRef, useState } from 'react';
import { ArrowUp, ChevronRight, History, Sparkles } from 'lucide-react';
import type { PageProps } from '../types';
import './OverviewAssistant.css';

const suggestions = ['我今年要攒十万块', '帮我梳理本月开销', '查看任务进度'];

export function OverviewAssistant({ askAssistant, navigate, busy }: PageProps) {
  const [draft, setDraft] = useState('');
  const inputId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const submitted = useRef(false);

  function submit() {
    const text = draft.trim();
    if (!text || busy || submitted.current || !askAssistant) return;
    submitted.current = true;
    askAssistant(text);
  }

  return (
    <section className='overview-assistant' aria-label='小苔助手快捷提问'>
      <header className='overview-assistant-head'>
        <div><Sparkles size={17} aria-hidden='true' /><h2>今天，有什么交给小苔？</h2></div>
        <button type='button' onClick={() => navigate?.('assistant')}><History size={14} aria-hidden='true' />历史对话<ChevronRight size={13} aria-hidden='true' /></button>
      </header>
      <form className='overview-ask-box' onSubmit={event => { event.preventDefault(); submit(); }}>
        <label className='sr-only' htmlFor={inputId}>给小苔助手发消息</label>
        <textarea id={inputId} ref={inputRef} value={draft} maxLength={2000} rows={2}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
              event.preventDefault(); submit();
            }
          }} placeholder='问问小苔，或说说你想办的事…' />
        <div className='overview-ask-footer'>
          <button type='submit' disabled={busy || !draft.trim()} aria-label='发送并进入 AI 助手'><ArrowUp size={19} aria-hidden='true' /></button>
        </div>
      </form>
      <div className='overview-ask-suggestions' aria-label='快捷建议'>
        {suggestions.map(text => <button type='button' key={text} disabled={busy} onClick={() => { setDraft(text); inputRef.current?.focus(); }}>{text}<ChevronRight size={12} aria-hidden='true' /></button>)}
      </div>
    </section>
  );
}
