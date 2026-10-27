import { useEffect, useId, useRef } from 'react';

// One continuous surface supplies the forest, glass tint and curved shoulder.
// Only its right silhouette moves; the sidebar and its hit targets stay put.
export function SidebarSurface() {
  const id = useId().replace(/:/g,'');
  const path = useRef<SVGPathElement>(null);
  useEffect(() => {
    const panel=path.current?.closest('aside');
    if (!panel) return;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    let frame=0,width=panel.clientWidth,height=panel.clientHeight;
    let current={y:height/2,extent:0};
    let active:HTMLElement|null=null;
    const paint=()=>{
      const y=Math.max(48,Math.min(height-48,current.y)),w=width,e=current.extent;
      path.current?.setAttribute('d',`M0 0H${w}V${y-46}C${w} ${y-28} ${w+e} ${y-30} ${w+e} ${y}C${w+e} ${y+30} ${w} ${y+28} ${w} ${y+46}V${height}H0Z`);
    };
    const move=(item:HTMLElement|null)=>{
      if(active===item)return;
      active=item;
      cancelAnimationFrame(frame);
      const start={...current},started=performance.now();
      const rect=item?.getBoundingClientRect();
      const target={y:rect ? rect.top+rect.height/2-panel.getBoundingClientRect().top+panel.scrollTop : current.y,
        extent:item&&innerWidth>900&&!(panel.dataset.navScroll==='true'&&item.closest('.sidebar-nav')) ? 22 : 0};
      const tick=(now:number)=>{
        const t=reduced.matches ? 1 : Math.min(1,(now-started)/340);
        const k=1-Math.pow(1-t,3);
        current={y:start.y+(target.y-start.y)*k,extent:start.extent+(target.extent-start.extent)*k};
        paint();
        if(t<1)frame=requestAnimationFrame(tick);
      };
      frame=requestAnimationFrame(tick);
    };
    const focusItem=()=>panel.querySelector<HTMLElement>('.nav-item:focus-visible');
    const over=(event:Event)=>move((event.target as Element).closest<HTMLElement>('.nav-item'));
    const leave=()=>move(focusItem());
    const focus=()=>{const item=focusItem();if(item)move(item);};
    const blur=()=>queueMicrotask(()=>move(panel.querySelector<HTMLElement>('.nav-item:hover')??focusItem()));
    const resize=new ResizeObserver(()=>{
      width=panel.clientWidth;height=Math.max(panel.clientHeight,panel.scrollHeight);
      const nav=panel.querySelector<HTMLElement>('.sidebar-nav');
      if(nav)panel.dataset.navScroll=String(nav.scrollHeight>nav.clientHeight+1);
      if(active){const previous=active;active=null;move(previous);}else paint();
    });
    resize.observe(panel);
    const nav=panel.querySelector('.sidebar-nav');
    if(nav)resize.observe(nav);
    panel.addEventListener('pointerover',over);panel.addEventListener('pointerleave',leave);
    panel.addEventListener('focusin',focus);panel.addEventListener('focusout',blur);
    paint();
    return()=>{
      cancelAnimationFrame(frame);resize.disconnect();
      panel.removeEventListener('pointerover',over);panel.removeEventListener('pointerleave',leave);
      panel.removeEventListener('focusin',focus);panel.removeEventListener('focusout',blur);
    };
  },[]);
  return <>
    <svg className="sidebar-mask-defs" aria-hidden="true"><defs><clipPath id={id} clipPathUnits="userSpaceOnUse"><path ref={path} /></clipPath></defs></svg>
    <div className="sidebar-surface" aria-hidden="true" style={{clipPath:`url(#${id})`}} />
  </>;
}
