import { useId, useState } from 'react';
import { ArrowRight, Check, MessageSquare } from 'lucide-react';
import type { AgentQuestion } from '../agent-types';
import { DateTimePicker } from './DateTimePicker';
import { buildAnswers } from '../../shared/question-logic.mjs';

export function AgentQuestions({ questions, disabled, onSend }: {
  questions: AgentQuestion[]; disabled: boolean; onSend: (text: string) => Promise<boolean>;
}) {
  const uid = useId();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState(false);
  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState(false);
  const result = buildAnswers(questions, choices, values);
  const activeQuestions = result.questions;
  const text = custom ? answer.trim() : result.text;
  const updateField = (question: AgentQuestion, id: string, value: string) => {
    setValues(current => ({ ...current, [id]: value }));
    setChoices(current => ({ ...current, [question.id]: '' }));
  };
  const locked = disabled || sending;
  return <form className='agent-questions' aria-label='需要你确认' onSubmit={async event => {
    event.preventDefault();
    if (!text || locked) return;
    setSending(true);
    try { await onSend(text); } finally { setSending(false); }
  }}>
    <div className='agent-questions-heading'><MessageSquare size={15} /><strong>需要你确认</strong><span>{activeQuestions.length} 项</span></div>
    <p className='agent-questions-intro'>选好或填好后，一起告诉小苔。</p>
    {activeQuestions.length < questions.length && <p className='agent-question-branch' role='status'>已按你的选择省略不适用的问题。</p>}
    {!custom && activeQuestions.map((question, index) => <fieldset key={question.id} disabled={locked}>
      <legend><span>{index + 1}</span>{question.label}</legend>
      {question.hint && <p className='agent-question-hint'>{question.hint}</p>}
      {question.options?.map(option => <label className='agent-answer-option' key={option.id} data-selected={choices[question.id] === option.id}>
        <input type='radio' name={`${uid}-${question.id}`} value={option.id} checked={choices[question.id] === option.id} onChange={() => {
          setChoices(current => ({ ...current, [question.id]: option.id }));
          setValues(current => ({ ...current, ...Object.fromEntries((question.fields ?? []).map(field => [field.id, ''])) }));
        }} />
        <span className='agent-answer-check' aria-hidden='true'>{choices[question.id] === option.id && <Check size={12} />}</span>
        <span><strong>{option.label}</strong>{option.detail && <small>{option.detail}</small>}</span>
      </label>)}
      {question.fields?.map(field => <label key={field.id} className='agent-answer-field'>
        <span>{field.label}</span><span className='agent-answer-input'>
          {field.type === 'date' || field.type === 'datetime-local' ? <DateTimePicker type={field.type} value={values[field.id] ?? ''} onChange={value => updateField(question, field.id, value)} aria-label={field.label} disabled={locked} /> : <input type='text' inputMode={field.type === 'money' ? 'decimal' : field.type === 'number' ? 'numeric' : undefined} value={values[field.id] ?? ''} placeholder={field.placeholder} maxLength={field.type === 'text' ? 500 : 16} onChange={event => updateField(question, field.id, event.target.value)} aria-label={field.label} />}{(field.suffix || field.type === 'money') && <span>{field.suffix ?? '元'}</span>}
        </span>
      </label>)}
    </fieldset>)}
    {custom && <label className='agent-custom-answer'><span>用自己的话补充或修改条件</span><textarea value={answer} onChange={event => setAnswer(event.target.value)} maxLength={1500} rows={3} placeholder='补充你的想法，也可以修改前面说过的条件' disabled={locked} /></label>}
    <div className='agent-question-footer'>
      <button type='button' className='agent-answer-custom' onClick={() => setCustom(!custom)} disabled={locked}>{custom ? '返回选择填写' : '我想自己说'}</button>
      <button type='submit' className='agent-answer-submit' disabled={locked || !text}>{sending ? '正在发送' : custom ? '发送补充' : `确认${activeQuestions.length}项并继续`}<ArrowRight size={14} /></button>
    </div>
  </form>;
}
