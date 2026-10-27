const own=(object,key)=>Object.hasOwn(object??{},key);

// Conditions refer only to earlier questions; hidden answers never drive a branch.
export function visibleQuestions(questions, choices={}, values={}) {
  const earlier=new Map(),visible=[];
  for(const question of questions){
    const active=!(question.visibleWhen??[]).some(condition=>{
      const parent=earlier.get(condition.questionId);
      if(!parent||!Array.isArray(condition.optionIds))return false;
      if(!parent.visible)return true;
      const option=parent.question.options?.find(item=>own(choices,parent.question.id)&&item.id===choices[parent.question.id]);
      const field=parent.question.fields?.find(item=>item.id===condition.fieldId);
      const raw=field&&own(values,field.id)?String(values[field.id]).trim():'';
      const fieldMatches=field&&Array.isArray(condition.values)&&fieldAnswer(field,raw)&&condition.values.some(value=>
        ['money','number'].includes(field.type)?Number(raw)===Number(value):raw===value);
      const matches=Boolean(option&&condition.optionIds.includes(option.id)||fieldMatches);
      return condition.not ? matches : !matches;
    });
    earlier.set(question.id,{question,visible:active});
    if(active)visible.push(question);
  }
  return visible;
}

function validDate(value,datetime=false){
  if(!(datetime?/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/:/^\d{4}-\d{2}-\d{2}$/).test(value))return false;
  const date=new Date(value+(datetime?':00Z':'T00:00:00Z'));
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,datetime?16:10)===value;
}

function fieldAnswer(field, raw){
  const value=String(raw??'').trim();
  if(!value)return '';
  if(field.type==='money'||field.type==='number'){
    const pattern=field.type==='money'?/^\d+(?:\.\d{1,2})?$/:/^\d+$/;
    const number=Number(value);
    if(!pattern.test(value)||!Number.isFinite(number)||number<0||number>(field.type==='money'?1e9:Number.MAX_SAFE_INTEGER))return '';
    if(field.type==='number'&&!Number.isSafeInteger(number))return '';
    if(field.min!==undefined&&number<field.min||field.max!==undefined&&number>field.max)return '';
  }else if(field.type==='date'||field.type==='datetime-local'){
    if(!validDate(value,field.type==='datetime-local'))return '';
  }else if(field.type==='text'){
    if(value.length>500)return '';
  }else return '';
  return `${field.prefix??''}${value}${field.suffix??(field.type==='money'?'元':'')}`;
}

export function buildAnswers(questions,choices={},values={}){
  const active=visibleQuestions(questions,choices,values);
  const replies=active.map(question=>{
    const option=question.options?.find(item=>own(choices,question.id)&&item.id===choices[question.id]);
    if(option)return typeof option.reply==='string'?option.reply.trim():'';
    if(!question.fields?.length)return '';
    const fields=question.fields.map(field=>fieldAnswer(field,own(values,field.id)?values[field.id]:undefined));
    return fields.every(Boolean)?fields.join('，'):'';
  });
  const complete=Boolean(active.length&&replies.every(Boolean));
  return {questions:active,text:complete?replies.join('；'):'',complete};
}
