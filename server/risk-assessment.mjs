import questionnaire from './risk-questionnaire.private.json' with { type: 'json' };
import publicQuestionnaire from '../shared/risk-questionnaire.json' with { type: 'json' };

export const RISK_QUESTIONNAIRE = publicQuestionnaire;
export function validRiskAnswers(answers) {
  return Array.isArray(answers) && answers.length === questionnaire.questions.length
    && questionnaire.questions.every((question, index) => Number.isInteger(answers[index]) && answers[index] >= 0 && answers[index] < question.options.length);
}

// Project-only demonstrator, not a financial institution's suitability model.
export function scoreRiskAnswers(answers) {
  if (!validRiskAnswers(answers)) throw new TypeError('Incomplete risk questionnaire');
  const points = questionnaire.questions.map((question, index) => question.scores[answers[index]]);
  const score = Math.round(points.reduce((sum, value) => sum + value, 0) / (points.length * 4) * 100);
  const knowledge = questionnaire.questions.map((q, index) => q.section === 'knowledge' ? index : -1).filter(index => index >= 0);
  const knowledgeCorrect = knowledge.filter(index => points[index] === 4).length;
  let level = score <= 20 ? 1 : score <= 40 ? 2 : score <= 60 ? 3 : score <= 80 ? 4 : 5;
  const limits = [];
  const limit = (maximum, reason) => { level = Math.min(level, maximum); limits.push(reason); };
  if (answers[5] === 0) limit(1, '你表示不能承受本金亏损，演示档位上限为R1；R1也不代表保本。');
  if (answers[2] < 2) limit(2, '尚无独立应急储备或不足1个月，演示档位上限为R2。');
  if (answers[3] === 0) limit(2, '持续收入尚不能覆盖必要支出，演示档位上限为R2。');
  if (answers[4] === 0) limit(2, '这笔资金3个月内可能使用，演示档位上限为R2。');
  if (answers[7] === 0) limit(1, '短期下跌会影响必要生活或计划，演示档位上限为R1。');
  if (knowledgeCorrect < 2) limit(2, '基础知识正确项不足2项，演示档位上限为R2。');
  if (answers[0] === 0) limit(3, '尚无实际投资经验，演示档位上限为R3。');
  return { level, score, maxScore: 100, questionnaireVersion: questionnaire.version, knowledgeCorrect, knowledgeTotal: knowledge.length,
    summary: limits.length ? limits : ['已综合投资经历、资金用途、承受能力与基础知识计算项目演示档位。'] };
}
