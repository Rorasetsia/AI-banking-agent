import {useState} from 'react';
import {ArrowRight} from 'lucide-react';
export function AgentFollowup({busy,onSend,label='用自己的话修改或安排下一步'}:{busy:boolean;onSend:(text:string)=>Promise<boolean>;label?:string}){
 const [text,setText]=useState('');
 return <details className='agent-followup'><summary>{label}</summary><form onSubmit={async e=>{e.preventDefault();if(text.trim()&&!busy&&await onSend(text.trim()))setText('');}}>
  <label><span>告诉小苔你的想法</span><textarea rows={2} maxLength={1500} value={text} onChange={e=>setText(e.target.value)} placeholder='补充或修改条件，也可以提出下一步想做的事' disabled={busy}/></label>
  <button type='submit' disabled={busy||!text.trim()}>发送给小苔<ArrowRight size={13}/></button>
 </form></details>;
}
