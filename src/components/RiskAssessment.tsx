import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, ShieldCheck } from 'lucide-react';
import questionnaire from '../../shared/risk-questionnaire.json';

interface RiskAssessmentProps {
  answers: (number | null)[];
  onAnswer: (index: number, value: number) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBack: () => void;
  busy: boolean;
  error: string;
  previousLevel?: number;
}

export function RiskAssessment({ answers, onAnswer, onSubmit, onBack, busy, error, previousLevel }: RiskAssessmentProps) {
  const [step, setStep] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const section = questionnaire.sections[step];
  const questions = questionnaire.questions.map((question, index) => ({ ...question, index })).filter(question => question.section === section.id);
  const answered = answers.filter(answer => typeof answer === 'number').length;
  const sectionComplete = questions.every(question => typeof answers[question.index] === 'number');
  useEffect(() => { heading.current?.focus(); }, [step]);

  return <section className='risk-assessment' aria-labelledby='risk-assessment-title'>
    <header className='risk-assessment-head'>
      <button type='button' className='risk-back' onClick={onBack} disabled={busy}><ArrowLeft size={15} /> 返回理财</button>
      <span><ShieldCheck size={14} /> 项目演示问卷</span>
    </header>
    <div className='risk-assessment-intro'><p className='eyebrow'>YOUR INVESTMENT PROFILE</p><h2 id='risk-assessment-title'>{questionnaire.title}</h2><p>按实际经历和承受能力作答，不必追求更高档位。结果只用于本项目的模拟拦截。</p></div>
    <nav className='risk-steps' aria-label='风险评估步骤'>
      {questionnaire.sections.map((item, index) => <button type='button' key={item.id} aria-current={index === step ? 'step' : undefined} disabled={busy} onClick={() => setStep(index)}><span>{index < step ? <Check size={13} /> : String(index + 1).padStart(2, '0')}</span>{item.title}</button>)}
    </nav>
    <div className='risk-progress'><span>已完成 {answered} / {questionnaire.questions.length} 题</span><progress value={answered} max={questionnaire.questions.length} aria-label='问卷完成进度' /></div>
    <form onSubmit={onSubmit}>
      <div className='risk-section-heading'><h3 ref={heading} tabIndex={-1}>{section.title}</h3><p>{section.description}</p></div>
      <div className='risk-questions'>{questions.map(question => <fieldset key={question.id} disabled={busy} className='risk-question'>
        <legend><span>{String(question.index + 1).padStart(2, '0')}</span>{question.title}</legend>
        <div className='risk-choices'>{question.options.map((option, index) => <label key={option} className={`risk-choice ${answers[question.index] === index ? 'is-selected' : ''}`}>
          <input type='radio' name={question.id} value={index} checked={answers[question.index] === index} onChange={() => onAnswer(question.index, index)} />
          <span className='risk-choice-letter' aria-hidden='true'>{String.fromCharCode(65 + index)}</span><span>{option}</span><span className='risk-choice-dot' aria-hidden='true'>{answers[question.index] === index && <Check size={12} />}</span>
        </label>)}</div>
      </fieldset>)}</div>
      {error && <p className='risk-form-error' role='alert'>{error}</p>}
      <footer className='risk-question-footer'>
        <p>{previousLevel ? `提交后将更新当前演示R${previousLevel}结果。` : '只有完整提交后才会保存评估结果。'}</p>
        <div>{step > 0 && <button type='button' className='risk-back' disabled={busy} onClick={() => setStep(value => value - 1)}>上一步</button>}
          {step < questionnaire.sections.length - 1 ? <button type='button' className='button btn-primary' disabled={busy || !sectionComplete} onClick={() => setStep(value => value + 1)}>下一部分 <ArrowRight size={15} /></button> : <button type='submit' className='button btn-primary' disabled={busy || answered !== questionnaire.questions.length}>{busy ? '正在保存…' : '提交评估'}</button>}
        </div>
      </footer>
    </form>
    <p className='risk-method-note'>这是一份项目自定义演示问卷，不替代销售机构正式适当性评估；R1也不代表保本。知识题参考 <a href='https://www.investor.gov/introduction-investing/getting-started/asset-allocation' target='_blank' rel='noreferrer'>Investor.gov 投资基础</a>。评分同时考虑资金用途和承受能力，知识正确或收益期待高不会单独解除限制。</p>
  </section>;
}
