import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';

/** Keep form drafts mounted while exposing one intentional entry point. */
export function FeatureEntry({ title, description, children, revealKey = 0 }: {title:string;description:string;children:ReactNode;revealKey?:number}) {
  const [open,setOpen]=useState(false);
  const launch=useRef<HTMLButtonElement>(null),back=useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(revealKey>0)setOpen(true);},[revealKey]);
  useEffect(()=>{if(open){back.current?.focus({preventScroll:true});back.current?.scrollIntoView({block:'nearest'});}},[open]);
  return <div className="feature-entry" data-feature={title}>
    {!open&&<button type="button" className="feature-launch" ref={launch} onClick={()=>setOpen(true)}><span><strong>{title}</strong><small>{description}</small></span><ArrowUpRight size={21} aria-hidden="true"/></button>}
    <div className="feature-entry-body" hidden={!open} inert={!open}>
      <button ref={back} type="button" className="feature-back" onClick={()=>{setOpen(false);requestAnimationFrame(()=>launch.current?.focus({preventScroll:true}));}}><ArrowLeft size={15}/><span>返回功能入口</span></button>
      {children}
    </div>
  </div>;
}
