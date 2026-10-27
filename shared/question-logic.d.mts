import type { AgentQuestion } from '../src/agent-types';
export function visibleQuestions(questions: AgentQuestion[], choices?: Record<string,string>, values?: Record<string,string>): AgentQuestion[];
export function buildAnswers(questions: AgentQuestion[], choices?: Record<string,string>, values?: Record<string,string>): {questions:AgentQuestion[];text:string;complete:boolean};
