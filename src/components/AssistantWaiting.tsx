import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';

export function AssistantWaiting() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <div className='assistant-waiting' role='status' aria-live='polite'>
    <span className='waiting-orbit' aria-hidden='true'><Sparkles size={19} /><i /></span>
    <div><strong>{seconds >= 20 ? '这次思考稍久，仍在等模型返回' : '小苔正在理解你的需求'}<span className='waiting-dots' aria-hidden='true'><i /><i /><i /></span></strong>
      <p>{seconds >= 20 ? '请稍候，输入已保留；失败后可以重试。' : '收到结果后，会把方案和需要确认的条件一起呈现。'}</p>
      <div className='waiting-line' aria-hidden='true' />
    </div>
  </div>;
}
