/** Keep a picker below its control; create temporary scroll room at page end. */
export function pickerRoom(control:HTMLElement, desired=360){
  const bottomInset=innerWidth<=900?82:16;
  let spacer:HTMLDivElement|null=null;
  let box=control.getBoundingClientRect();
  // Navigation drawers scroll independently of the page.
  const drawer=control.closest<HTMLElement>('.sidebar');
  if(drawer&&getComputedStyle(drawer).position==='fixed'){
    const gap=Math.max(0,desired+bottomInset-(innerHeight-box.bottom));
    if(gap){spacer=document.createElement('div');spacer.dataset.pickerSpace='';spacer.style.cssText=`height:${gap}px;flex:0 0 ${gap}px;pointer-events:none`;drawer.append(spacer);drawer.scrollBy({top:Math.min(gap,Math.max(0,box.top-90)),behavior:'instant'});}
  }else if(!drawer&&innerHeight-box.bottom<desired+bottomInset){
    const shift=Math.min(desired+bottomInset-(innerHeight-box.bottom),Math.max(0,box.top-100));
    const missing=Math.max(0,shift-(document.documentElement.scrollHeight-innerHeight-scrollY));
    if(missing){spacer=document.createElement('div');spacer.dataset.pickerSpace='';spacer.style.cssText=`height:${missing+8}px;pointer-events:none`;document.body.append(spacer);}
    window.scrollBy({top:shift,behavior:'instant'});
  }
  return ()=>spacer?.remove();
}

/** Native select values, validation and keyboard behavior stay with the browser. */
export function installDownwardSelects(){
  let active:HTMLSelectElement|null=null,release:(()=>void)|undefined;
  const clear=()=>{release?.();release=undefined;active=null;};
  const place=()=>{
    if(!active)return;
    const b=active.getBoundingClientRect(),safe=innerWidth<=900?82:16;
    const w=Math.min(Math.max(b.width,150),innerWidth-16);
    active.style.setProperty('--picker-top',`${b.bottom+5}px`);
    active.style.setProperty('--picker-left',`${Math.max(8,Math.min(b.left,innerWidth-w-8))}px`);
    active.style.setProperty('--picker-width',`${w}px`);
    active.style.setProperty('--picker-height',`${Math.max(36,Math.min(340,innerHeight-b.bottom-safe-5))}px`);
  };
  const prepare=(event:Event)=>{
    const target=event.target;
    if(!(target instanceof HTMLSelectElement)||target.disabled){if(event.type==='pointerdown'&&!(target instanceof HTMLOptionElement))clear();return;}
    if(event instanceof KeyboardEvent&&![' ','Enter','ArrowDown','ArrowUp','F4'].includes(event.key))return;
    if(active!==target){clear();active=target;release=pickerRoom(target,Math.min(340,target.options.length*40+14));}
    place();
  };
  const changed=(event:Event)=>{if(event.target===active)clear();};
  const afterToggle=()=>requestAnimationFrame(()=>{if(active&&!active.matches(':open'))clear();});
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape')clear();else prepare(event);};
  document.addEventListener('pointerdown',prepare,true);document.addEventListener('keydown',key,true);
  document.addEventListener('pointerup',afterToggle,true);document.addEventListener('keyup',afterToggle,true);
  document.addEventListener('change',changed,true);document.addEventListener('focusout',changed,true);
  window.addEventListener('scroll',place,true);window.addEventListener('resize',place);window.addEventListener('hashchange',clear);
  return()=>{clear();document.removeEventListener('pointerdown',prepare,true);document.removeEventListener('keydown',key,true);document.removeEventListener('pointerup',afterToggle,true);document.removeEventListener('keyup',afterToggle,true);document.removeEventListener('change',changed,true);document.removeEventListener('focusout',changed,true);window.removeEventListener('scroll',place,true);window.removeEventListener('resize',place);window.removeEventListener('hashchange',clear);};
}
