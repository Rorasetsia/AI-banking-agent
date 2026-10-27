import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, ChevronRight, Leaf, ShieldCheck, Sparkles } from 'lucide-react';
import type { Route } from '../types';
import './Welcome.css';
import { ForestWind } from './ForestWind';

interface WelcomeProps { onStart: () => void; onExplore?: (route: Route) => void }
const CHAPTERS: { label: string; en: string; title: [string, string]; description: string; tags: string[]; route: Route }[] = [
  { label: 'AI助手', en: 'INTELLIGENCE, WITH INTENTION', title: ['一句话，', '让安排有了方向。'], description: '把日常银行事务交给对话。从理解需求到查看计划，每一步，都由你确认。', tags: ['自然对话', '计划先行', '确认执行'], route: 'assistant' },
  { label: '绿色金融', en: 'SMALL CHOICES. LASTING CHANGE.', title: ['算清生活成本，', '让绿色更合适。'], description: '家电换新还是继续用，通勤怎样更省钱省时？比较后选一个7天小目标，记录自己的改变。', tags: ['费用比较', '7天行动', '消费分析'], route: 'green' },
  { label: '账户服务', en: 'A CLEARER VIEW OF YOUR MONEY', title: ['日常往来与理财，', '一处从容安排。'], description: '看余额、管银行卡，办理转账与存取；了解风险偏好，比较理财产品与持仓，体验模拟申购赎回。', tags: ['账户与转账', '风险与持仓', '模拟申赎'], route: 'accounts' },
  { label: '账单与扣费', en: 'SMALL DETAILS. A BIGGER PICTURE.', title: ['看清日常，', '发现每一处细节。'], description: '从收支流水到持续扣费，了解钱的去向。核对订阅、设置有限监测，让异常线索更清楚。', tags: ['账单洞察', '订阅代扣', '扣费监测'], route: 'bills' },
  { label: '预约与凭证', en: 'THOUGHTFULLY PLANNED. CLEARLY RECORDED.', title: ['让未来的事，', '也有清楚的安排。'], description: '提前核对具体计划，明确授权每一次预约。执行状态与操作凭证，随时可以回看。', tags: ['预约安排', '明确授权', '凭证可查'], route: 'tasks' },
  { label: '家庭提醒', en: 'CARE, WITH RESPECT.', title: ['让关心靠近，', '也让边界清晰。'], description: '在双方知情同意后，分享约定范围内的提醒。把关心留给家人，把选择留给自己。', tags: ['双方同意', '最少分享', '随时撤销'], route: 'family' },
];
const mod = (n: number) => ((n % 6) + 6) % 6;
const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
function paintFaces(element: HTMLDivElement | null, angle: number) {
  element?.style.setProperty('--turn', `${angle}deg`);
  element?.querySelectorAll<HTMLElement>('.ph-face').forEach((face, index) => {
    const signed = (((index * 60 - angle + 180) % 360 + 360) % 360) - 180;
    const difference = Math.abs(signed);
    // Keep every physical surface intact. Only lighting follows the angle.
    face.style.setProperty('--facing-shade', String((1 - Math.max(0, Math.cos(difference * Math.PI / 180))) * .85));
  });
}
function paintChapters(root: HTMLElement | null, angle: number) {
  root?.querySelectorAll<HTMLElement>('[data-chapter]').forEach(element => {
    const difference = Math.abs((((Number(element.dataset.chapter) * 60 - angle + 180) % 360 + 360) % 360) - 180);
    const energy = Math.max(0, 1 - difference / 60);
    element.style.setProperty('--chapter-energy', String(energy));
  });
}

function updateWorkspaceGlow(button: HTMLButtonElement) {
  // Change playback rate without restarting the light band's current position.
  const rate = button.matches(':hover, :focus-visible') ? 1.25 : 1;
  button.getAnimations({ subtree: true }).forEach(animation => {
    if (animation instanceof CSSAnimation && animation.animationName === 'ph-rim-flow') {
      animation.updatePlaybackRate(rate);
    }
  });
}

function FeaturePreview({ index }: { index: number }) {
  return <div className={`ph-preview ph-preview--${index}`} aria-hidden="true">
    <div className="ph-preview-orbit" /><div className="ph-preview-orbit ph-preview-orbit--two" />
    <div className="ph-preview-window">
      <div className="ph-window-top"><span><i /> 小苔 · {CHAPTERS[index].label}</span><small>演示示意</small></div>
      {index === 0 ? <>
        <div className="ph-chat">帮我看看这个月的钱花在哪了<span>↗</span></div>
        <div className="ph-assistant"><span className="ph-ai-icon"><Sparkles size={17} /></span><p>从一份清楚的账单开始。<small>收支结构 · 分类明细 · 异常线索</small></p></div>
        <div className="ph-plan"><span className="ph-micro">YOUR NEXT STEP</span><strong>先了解，再决定。</strong><div><span>查看分析与后续计划</span><ArrowRight size={15} /></div></div>
        <div className="ph-preview-foot"><ShieldCheck size={12} /> 操作前核对计划，由你确认</div>
      </> : index === 1 ? <>
        <span className="ph-micro ph-preview-label">MAKE EVERYDAY CHOICES COUNT</span>
        <div className="ph-green-options"><div><Leaf size={18} /><span>家电使用比较<small>继续用 / 换新 · 算清总成本</small></span></div><div><ArrowRight size={18} /><span>通勤方案比较<small>每天花多少钱、用多少时间</small></span></div></div>
        <div className="ph-green-goal"><span>我的7天行动</span><div>{Array.from({ length: 7 }, (_, day) => <i key={day}>{day + 1}</i>)}</div><small>自愿设定目标，记录日常行动</small></div>
        <div className="ph-preview-foot">示意展示 · 费用估算与行动自记</div>
      </> : index === 2 ? <>
        <div className="ph-bank-card"><div>小苔 <Leaf size={16} /></div><small>ACCOUNT & WEALTH</small><strong>往来有数，理财有方。</strong><span>可用余额 <i /> 资金预留 <i /> 理财持仓</span><div className="ph-card-chip" /></div>
        <div className="ph-quick"><span>↗<small>转账存取</small></span><span>▤<small>银行卡</small></span><span>↗<small>理财账户</small></span></div>
        <div className="ph-preview-row ph-account-wealth"><span>风险评估</span><ChevronRight size={13} /><span>产品比较</span><ChevronRight size={13} /><span>模拟申赎</span></div>
        <div className="ph-preview-foot">投资有风险，模拟不代表真实收益</div>
      </> : index === 3 ? <>
        <div className="ph-chart-heading"><span>日常收支<small>看见每一笔的去向</small></span><span className="ph-chart-pill">月度视角</span></div>
        <div className="ph-bars">{[34, 58, 42, 79, 51, 94, 65, 47, 73, 59, 86, 68].map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</div>
        <div className="ph-axis"><span>01</span><span>15</span><span>30</span></div>
        <div className="ph-billing-line"><span className="ph-billing-dot" /><span>订阅与代扣<small>了解授权，核对下次扣费</small></span><ChevronRight size={17} /></div>
      </> : index === 4 ? <>
        <span className="ph-micro ph-preview-label">EVERY STEP, ACCOUNTED FOR</span><div className="ph-timeline">{[['01', '核对具体计划', '时间、对象与金额，逐项确认'], ['02', '明确授权预约', '操作前完成必要的安全验证'], ['03', '回看状态与凭证', '以实际执行结果为准']].map(([n, title, sub]) => <div key={n}><b>{n}</b><span>{title}<small>{sub}</small></span></div>)}</div>
      </> : <>
        <div className="ph-family-orbit"><span>你</span><div><Leaf size={23} /><small>知情 · 同意</small></div><span>家人</span></div>
        <div className="ph-family-note"><ShieldCheck size={18} /><div>只分享约定的提醒<small>不分享完整账单，不赋予资金权限</small></div></div>
        <div className="ph-preview-foot">任何一方都可随时撤销关系</div>
      </>}
    </div>
    <span className="ph-visual-caption">{['A LITTLE CLARITY, EVERY DAY.', 'SMALL STEPS, LASTING CHANGE.', 'EVERYTHING, IN PERSPECTIVE.', 'UNDERSTAND YOUR EVERYDAY.', 'MAKE ROOM FOR WHAT MATTERS.', 'CONNECTED, ON YOUR TERMS.'][index]}</span>
  </div>;
}

export function Welcome({ onStart, onExplore }: WelcomeProps) {
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 960, height: 540 });
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const root = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const rotor = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const motion = useRef<Animation | null>(null);
  const angle = useRef(0);
  const locked = useRef(false);
  const wheelCooldown = useRef(0);
  const pointer = useRef<{ y: number; x: number; id: number } | null>(null);
  const radius = dimensions.height * Math.sqrt(3) / 2;

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const listener = () => setReduced(query.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);
  useLayoutEffect(() => { paintFaces(rotor.current, angle.current); }, []);
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const mobile = window.innerWidth <= 600;
      const reserve = window.innerWidth < 1100 ? 155 : 185;
      const faceWidth = Math.max(1, Math.min(960, mobile ? width : width - reserve * 2, (height - 28) / 1.6 * 16 / 9));
      setDimensions({ width: faceWidth, height: faceWidth * 9 / 16 });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => { cancelAnimationFrame(frame.current); motion.current?.cancel(); }, []);
  useEffect(() => { if (reduced && locked.current) motion.current?.finish(); }, [reduced]);

  const turn = useCallback((steps: number) => {
    if (locked.current || !steps) return;
    const from = angle.current;
    const to = from + steps * 60;
    const next = mod(Math.round(to / 60));
    if (reduced) {
      angle.current = to;
      paintFaces(rotor.current, to);
      paintChapters(root.current, to);
      root.current?.style.setProperty('--pulse', '0');
      setActive(next);
      return;
    }
    locked.current = true;
    setBusy(true);
    const duration = 1320 + (Math.abs(steps) - 1) * 160;
    // Positive rotation lifts the front and reveals the next face from below.
    // The shared compositor animation keeps the camera fixed.
    const keyframes = Array.from({ length: 61 }, (_, index) => {
      const t = index / 60;
      return { offset: t, transform: `translateZ(${-radius}px) rotateX(${from + (to - from) * ease(t)}deg)` };
    });
    const animation = rotor.current!.animate(keyframes, { duration, fill: 'forwards', easing: 'linear' });
    motion.current = animation;
    const animate = () => {
      const t = Math.min(1, Number(animation.currentTime ?? 0) / duration);
      const eased = ease(t);
      const pulse = Math.pow(Math.sin(Math.PI * t), 2);
      angle.current = from + (to - from) * eased;
      paintFaces(rotor.current, angle.current);
      paintChapters(root.current, angle.current);
      root.current?.style.setProperty('--pulse', String(pulse));
      if (t < 1) frame.current = requestAnimationFrame(animate);
      else {
        angle.current = to;
        paintFaces(rotor.current, to);
        paintChapters(root.current, to);
        animation.cancel();
        motion.current = null;
        root.current?.style.setProperty('--pulse', '0');
        locked.current = false;
        wheelCooldown.current = performance.now() + 420;
        setActive(next);
        setBusy(false);
      }
    };
    frame.current = requestAnimationFrame(animate);
  }, [reduced, radius]);
  const select = (index: number) => { let delta = mod(index - mod(Math.round(angle.current / 60))); if (delta > 3) delta -= 6; turn(delta); };

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let sum = 0;
    let last = 0;
    const wheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest('details')) return;
      event.preventDefault();
      const now = performance.now();
      if (locked.current || now < wheelCooldown.current || Math.abs(event.deltaX) > Math.abs(event.deltaY)) { sum = 0; return; }
      if (now - last > 160 || Math.sign(event.deltaY) !== Math.sign(sum)) sum = 0;
      last = now;
      sum += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
      // Follow content movement: the trackpad's upward swipe advances the
      // lower face into view. Pointer dragging keeps its own coordinate sign.
      if (Math.abs(sum) > 44) { turn(sum > 0 ? 1 : -1); sum = 0; }
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [turn]);

  const endSwipe = (event: ReactPointerEvent) => {
    const start = pointer.current;
    pointer.current = null;
    if (!start || event.pointerId !== start.id) return;
    const dy = event.clientY - start.y;
    if (Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(event.clientX - start.x)) turn(dy < 0 ? 1 : -1);
  };
  const vars = { '--face-w': `${dimensions.width}px`, '--face-h': `${dimensions.height}px`, '--radius': `${radius}px`, '--perspective': `${dimensions.width * 1.1}px` } as CSSProperties;

  return <main className="prism-home" ref={root} data-backdrop="forest" data-motion={reduced ? 'reduced' : 'full'} style={vars}
    onKeyDown={event => { if ((event.target as HTMLElement).closest('details,input,textarea,select')) return; if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); turn(event.key === 'ArrowDown' ? 1 : -1); } }}>
    <div className="ph-backdrop" aria-hidden="true" />
    {!reduced && <ForestWind />}
    <div className="ph-ambient ph-ambient--one" aria-hidden="true" /><div className="ph-ambient ph-ambient--two" aria-hidden="true" /><div className="ph-environment" aria-hidden="true" />
    <header className="ph-header">
      <div className="ph-brand"><span className="ph-brand-icon"><Leaf size={25} strokeWidth={1.5} /></span><span><strong>小苔</strong><small>AI BANKING</small></span></div>
      <span className="ph-header-note">让日常金融，自然发生。</span>
      <span className="ph-header-edition">小苔 · 日常金融的六种可能</span>
    </header>

    <div className="ph-stage" ref={stage} aria-label="六面功能展示" aria-roledescription="轮播" aria-busy={busy}
      onPointerDown={event => { if ((event.target as HTMLElement).closest('button,a,summary,input') || (event.pointerType === 'mouse' && event.button !== 0)) return; pointer.current = { y: event.clientY, x: event.clientX, id: event.pointerId }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerUp={endSwipe} onPointerCancel={() => { pointer.current = null; }}>
      <div className="ph-backtitle" aria-hidden="true">{CHAPTERS.map((chapter, index) => <span key={chapter.route} data-chapter={index} style={{ '--chapter-energy': index === 0 ? 1 : 0 } as CSSProperties}>{chapter.label}</span>)}</div>
      <div className="ph-halo" aria-hidden="true"><i /><i /></div><div className="ph-floor" aria-hidden="true" />
      <div className="ph-scene">
        <div className="ph-rotor" ref={rotor}>
          {CHAPTERS.map((chapter, index) => <div key={chapter.route} className="ph-seal" aria-hidden="true" style={{ '--face-index': index } as CSSProperties} />)}
          {CHAPTERS.map((chapter, index) => <section key={chapter.route} className="ph-face" id={`ph-face-${index}`} aria-labelledby={`ph-tab-${index}`} role="tabpanel" aria-hidden={index !== active} inert={index !== active || busy} style={{ '--face-index': index } as CSSProperties}>
            <div className="ph-face-material" aria-hidden="true" /><div className="ph-face-sheen" aria-hidden="true" />
            <div className="ph-face-heading"><span><i /> {chapter.label}</span><span>小苔 / {String(index + 1).padStart(2, '0')}</span></div>
            <div className="ph-face-body">
              <div className="ph-copy"><span className="ph-eyebrow">{chapter.en}</span><h1>{chapter.title[0]}<br /><em>{chapter.title[1]}</em></h1><p>{chapter.description}</p><button type="button" className="ph-explore" onClick={() => onExplore ? onExplore(chapter.route) : onStart()}>探索{chapter.label} <ArrowRight size={16} /></button></div>
              <FeaturePreview index={index} />
            </div>
            <div className="ph-face-bottom"><span>{chapter.tags.map((tag, i) => <span key={tag}>{i > 0 && <i />} {tag}</span>)}</span><span>THOUGHTFULLY CONNECTED <span className="ph-tiny-star">✳</span></span></div>
            <div className="ph-face-shade" aria-hidden="true" />
          </section>)}
          {[-1, 1].map(side => <div key={side} className="ph-endcap" style={{ '--side': side } as CSSProperties} aria-hidden="true" />)}
        </div>
      </div>
      <div className="ph-turn-controls"><button type="button" aria-label="上一个功能" onClick={() => turn(-1)} aria-disabled={busy}><ArrowUp size={18} /></button><span>{String(active + 1).padStart(2, '0')}<i />06</span><button type="button" aria-label="下一个功能" onClick={() => turn(1)} aria-disabled={busy}><ArrowDown size={18} /></button></div>
      <span className="ph-side-note" aria-hidden="true">SIX WAYS TO A SIMPLER EVERYDAY</span>
    </div>

    <div className="ph-dimmer" aria-hidden="true" />
    <aside className="ph-navigation" aria-label="探索功能与工作台入口">
      <span className="ph-nav-caption">日常的六种可能<small>EXPLORE THE POSSIBILITIES</small></span>
      <nav className="ph-tabs" role="tablist" aria-label="首页功能" aria-orientation="vertical">{CHAPTERS.map((chapter, index) => <button type="button" key={chapter.route} id={`ph-tab-${index}`} data-chapter={index} style={{ '--chapter-energy': index === 0 ? 1 : 0 } as CSSProperties} role="tab" aria-selected={active === index} aria-controls={`ph-face-${index}`} onClick={() => select(index)}><span className="ph-tab-number">0{index + 1}</span><span>{chapter.label}</span><i /></button>)}</nav>
      <span className="ph-input-hint"><ArrowUp size={12} /> 向上滚动或滑动，探索下一项</span>
    </aside>
    <button className="ph-workspace" type="button" aria-label="进入工作台" onClick={onStart}
      onPointerEnter={event => updateWorkspaceGlow(event.currentTarget)} onPointerLeave={event => updateWorkspaceGlow(event.currentTarget)}
      onFocus={event => updateWorkspaceGlow(event.currentTarget)} onBlur={event => updateWorkspaceGlow(event.currentTarget)}
    ><span><small>WORKSPACE</small><strong>进入工作台</strong></span><span className="ph-workspace-arrow"><ArrowRight size={23} /></span></button>
    <footer className="ph-footer"><span>独立银行模拟环境 <i /> 合成数据 <i /> 不发生真实交易</span><span className="ph-footer-note" aria-hidden="true">ROOTED IN EVERYDAY LIFE</span></footer>
    <span className="ph-sr-only" role="status" aria-live="polite" aria-atomic="true">第 {active + 1} 项，共 6 项：{CHAPTERS[active].label}</span>
  </main>;
}
