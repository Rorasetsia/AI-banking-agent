import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {CalendarDays,ChevronLeft,ChevronRight,Clock3} from 'lucide-react';
import {pickerRoom} from './picker-position';

type Kind='date'|'month'|'datetime-local'|'time';
interface Props {type:Kind;value:string;onChange:(value:string)=>void;id?:string;name?:string;className?:string;required?:boolean;disabled?:boolean;min?:string;max?:string;'aria-label'?:string}
const pad=(n:number)=>String(n).padStart(2,'0');
const dayKey=(d:Date)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const dateFrom=(v:string)=>{const m=/^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(v);return m?new Date(+m[1],+m[2]-1,+(m[3]||1),12):new Date();};
const shiftDay=(v:string,n:number)=>{const d=dateFrom(v);d.setDate(d.getDate()+n);return dayKey(d);};

export function DateTimePicker({type,value,onChange,id,name,className='',required,disabled,min,max,'aria-label':ariaLabel}:Props){
  const uid=useId(),fieldId=id||`date-${uid}`,panelId=`picker-${uid}`;
  const trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null);
  const [open,setOpen]=useState(false),[view,setView]=useState<'days'|'months'|'years'>(type==='month'?'months':'days');
  const [cursor,setCursor]=useState(()=>dateFrom(value)),[draft,setDraft]=useState(value),[focusDay,setFocusDay]=useState('');
  const [position,setPosition]=useState({top:0,left:0,width:300,maxHeight:360,visibility:'hidden' as 'hidden'|'visible'});
  const hasTime=type==='datetime-local'||type==='time';
  const selectedDay=draft.slice(0,10),monthKey=`${cursor.getFullYear()}-${pad(cursor.getMonth()+1)}`;
  const label=ariaLabel||(type==='month'?'选择月份':type==='time'?'选择时间':type==='datetime-local'?'选择预约日期和时间':'选择日期');
  const show=(v:string)=>!v?(type==='month'?'选择月份':type==='time'?'选择时间':type==='datetime-local'?'选择日期和时间':'选择日期'):type==='month'?`${v.slice(0,4)}年${Number(v.slice(5,7))}月`:type==='time'?v:`${v.slice(0,4)}年${Number(v.slice(5,7))}月${Number(v.slice(8,10))}日${type==='datetime-local'?' '+v.slice(11,16):''}`;
  const close=(restore=true)=>{setOpen(false);if(restore)trigger.current?.focus({preventScroll:true});};
  const start=()=>{if(open){close();return;}setDraft(value);setCursor(dateFrom(value));setView(type==='month'?'months':'days');setFocusDay(value.slice(0,10));setOpen(true);};
  const allowed=(v:string,kind:Kind=type)=>{const key=kind==='month'?v.slice(0,7):kind==='date'?v.slice(0,10):v;return(!min||key>=min.slice(0,key.length))&&(!max||key<=max.slice(0,key.length));};
  const time=draft.includes('T')?draft.slice(11,16):type==='time'?draft:'09:00';
  const commit=(v:string)=>{if(v&&!allowed(v))return;onChange(v);close();};
  const selectDay=(key:string)=>{setFocusDay(key);if(type==='datetime-local')setDraft(`${key}T${time||'09:00'}`);else commit(key);};
  const first=new Date(cursor.getFullYear(),cursor.getMonth(),1,12);first.setDate(1-(first.getDay()+6)%7);
  const visibleFocus=focusDay&&focusDay>=dayKey(first)&&focusDay<=shiftDay(dayKey(first),41)
    ?focusDay:monthKey===selectedDay.slice(0,7)?selectedDay:dayKey(cursor);
  useLayoutEffect(()=>{
    if(!open||!trigger.current)return;
    const release=pickerRoom(trigger.current,type==='month'?300:hasTime?470:370);
    const place=()=>{const b=trigger.current?.getBoundingClientRect();if(!b)return;const width=Math.min(320,innerWidth-24),safe=innerWidth<=900?82:14;setPosition({top:b.bottom+6,left:Math.max(12,Math.min(b.left,innerWidth-width-12)),width,maxHeight:Math.max(100,innerHeight-b.bottom-safe-6),visibility:'visible'});};
    place();window.addEventListener('scroll',place,true);window.addEventListener('resize',place);
    return()=>{release();window.removeEventListener('scroll',place,true);window.removeEventListener('resize',place);};
  },[open,type,hasTime]);
  useEffect(()=>{if(!open)return;const frame=requestAnimationFrame(()=>{
    const target=panel.current?.querySelector<HTMLElement>('[aria-selected="true"]:not(:disabled)')
      ||panel.current?.querySelector<HTMLElement>(`[data-day="${dayKey(cursor)}"]:not(:disabled)`)
      ||panel.current?.querySelector<HTMLElement>('.dtp-grid button:not(:disabled),.dtp-time button[aria-pressed="true"]')
      ||panel.current?.querySelector<HTMLElement>('button');
    target?.focus({preventScroll:true});
  });
    const outside=(e:PointerEvent)=>{if(!panel.current?.contains(e.target as Node)&&!trigger.current?.contains(e.target as Node))close(false);};
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'&&panel.current){const items=[...panel.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];if(e.shiftKey&&document.activeElement===items[0]||!e.shiftKey&&document.activeElement===items.at(-1)){close(false);}}};
    document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',key,true);return()=>{cancelAnimationFrame(frame);document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',key,true);};
  },[open]);
  useEffect(()=>{if(open&&view==='days')panel.current?.querySelector<HTMLButtonElement>(`[data-day="${visibleFocus}"]:not(:disabled)`)?.focus({preventScroll:true});},[visibleFocus,view,monthKey,open]);
  const move=(n:number)=>{const d=new Date(cursor);if(view==='years')d.setFullYear(d.getFullYear()+n*12);else if(view==='months')d.setFullYear(d.getFullYear()+n);else d.setMonth(d.getMonth()+n,1);if(d.getFullYear()>=1&&d.getFullYear()<=9999)setCursor(d);};
  const calendarKey=(e:React.KeyboardEvent)=>{
    let next=visibleFocus;
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
      e.preventDefault();next=shiftDay(next,({ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7} as Record<string,number>)[e.key]);
    }else if(e.key==='PageUp'||e.key==='PageDown'){
      e.preventDefault();const d=dateFrom(next),day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+(e.key==='PageUp'?-1:1));d.setDate(Math.min(day,new Date(d.getFullYear(),d.getMonth()+1,0).getDate()));next=dayKey(d);
    }else return;
    setCursor(dateFrom(next));setFocusDay(next);
  };
  const yearsStart=Math.floor(cursor.getFullYear()/12)*12;
  return <span className="date-time-picker">
    <button ref={trigger} id={fieldId} type="button" className={`dtp-trigger ${className}`} disabled={disabled} aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open} aria-controls={open?panelId:undefined} onClick={start} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();if(!open)start();}}}><span className={!value?'dtp-placeholder':''}>{show(value)}</span>{type==='time'?<Clock3 size={17}/>:<CalendarDays size={17}/>}</button>
    <input className="dtp-validation" type={type} name={name} value={value} onChange={e=>onChange(e.target.value)} required={required} disabled={disabled} min={min} max={max} tabIndex={-1} aria-hidden="true" onInvalid={e=>{e.preventDefault();trigger.current?.focus();if(!open)start();}}/>
    {open&&createPortal(<div ref={panel} id={panelId} role="dialog" aria-label={label} className="dtp-panel" style={position}>
      {type!=='time'&&<><header className="dtp-heading"><button type="button" aria-label={view==='years'?'上一组年份':view==='months'?'上一年':'上个月'} onClick={()=>move(-1)}><ChevronLeft size={17}/></button><button type="button" className="dtp-heading-label" onClick={()=>setView(view==='days'?'months':view==='months'?'years':type==='month'?'months':'days')}>{view==='years'?`${Math.max(1,yearsStart)} — ${yearsStart+11}年`:view==='months'?`${cursor.getFullYear()}年`:`${cursor.getFullYear()}年${cursor.getMonth()+1}月`}</button><button type="button" aria-label={view==='years'?'下一组年份':view==='months'?'下一年':'下个月'} onClick={()=>move(1)}><ChevronRight size={17}/></button></header>
      {view==='years'?<div className="dtp-grid dtp-months" role="grid" aria-label="年份">{Array.from({length:12},(_,i)=>yearsStart+i).filter(y=>y>0).map(y=><button type="button" role="gridcell" key={y} aria-selected={y===dateFrom(draft).getFullYear()} onClick={()=>{setCursor(new Date(y,cursor.getMonth(),1,12));setView('months');}}>{y}年</button>)}</div>:view==='months'?<div className="dtp-grid dtp-months" role="grid" aria-label="月份">{Array.from({length:12},(_,i)=>`${cursor.getFullYear()}-${pad(i+1)}`).map((m,i)=><button type="button" role="gridcell" key={m} aria-selected={m===draft.slice(0,7)} disabled={!allowed(m,'month')} onClick={()=>{if(type==='month')commit(m);else{setCursor(new Date(cursor.getFullYear(),i,1,12));setView('days');}}}>{i+1}月</button>)}</div>:<><div className="dtp-week" aria-hidden="true">{['一','二','三','四','五','六','日'].map(w=><span key={w}>{w}</span>)}</div><div className="dtp-grid dtp-days" role="grid" aria-label="日期" onKeyDown={calendarKey}>{Array.from({length:42},(_,i)=>{const d=new Date(first);d.setDate(first.getDate()+i);const key=dayKey(d);return <button type="button" role="gridcell" data-day={key} aria-label={key} aria-selected={key===selectedDay} aria-current={key===dayKey(new Date())?'date':undefined} tabIndex={key===visibleFocus?0:-1} className={d.getMonth()!==cursor.getMonth()?'dtp-outside':''} disabled={!allowed(key,'date')} key={key} onFocus={()=>setFocusDay(key)} onClick={()=>selectDay(key)}>{d.getDate()}</button>})}</div></>}
      </>}
      {hasTime&&<div className="dtp-time"><p><Clock3 size={15}/>选择时间 <strong>{time||'09:00'}</strong></p><div className="dtp-time-columns">{(['时','分'] as const).map((unit,col)=><div key={unit}><span>{unit}</span><div role="group" aria-label={unit==='时'?'小时':'分钟'}>{Array.from({length:col?60:24},(_,i)=>pad(i)).map(n=><button type="button" key={n} aria-label={`${n}${unit}`} aria-pressed={(time||'09:00').split(':')[col]===n} onClick={()=>{const t=(time||'09:00').split(':');t[col]=n;setDraft(type==='time'?t.join(':'):`${selectedDay||dayKey(cursor)}T${t.join(':')}`);}}>{n}</button>)}</div></div>)}</div></div>}
      <footer className="dtp-footer"><button type="button" onClick={()=>commit('')}>清除</button><button type="button" disabled={!allowed(type==='month'?dayKey(new Date()).slice(0,7):type==='time'?`${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`:dayKey(new Date()),type==='datetime-local'?'date':type)} onClick={()=>{const today=dayKey(new Date());if(type==='datetime-local'){setDraft(`${today}T${time||'09:00'}`);setCursor(dateFrom(today));setView('days');}else commit(type==='month'?today.slice(0,7):type==='time'?`${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`:today);}}>{type==='month'?'本月':type==='time'?'现在':'今天'}</button>{hasTime&&<button type="button" className="dtp-confirm" disabled={!draft||!allowed(draft)} onClick={()=>commit(draft)}>确定</button>}</footer>
    </div>,document.body)}
  </span>;
}




