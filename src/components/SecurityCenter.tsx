import { useCallback, useEffect, useId, useState, useRef } from 'react';
import type { FormEvent } from 'react';
import {Eye,EyeOff,ShieldCheck,CheckCircle2,AlertCircle} from 'lucide-react';
import './SecurityCenter.css';
import { money } from '../api';
import type { Plan } from '../types';
import {
  bindDevice,
  deviceEnvironment,
  formatTimestamp,
  passwordIssue,
  securityApi,
  verifyTransaction,
} from '../security';
import type { ProofPair, SecurityStatus } from '../security';

function PasswordField({id,label,value,onChange,disabled,hint,autoComplete='current-password'}:{id:string;label:string;value:string;onChange:(value:string)=>void;disabled?:boolean;hint?:string;autoComplete?:string}){
 const [shown,setShown]=useState(false);
 useEffect(()=>{if(!value)setShown(false);},[value]);
 return <div className='security-field'><label htmlFor={id}>{label}</label><div className='security-password'><input id={id} name={id} type={shown?'text':'password'} autoComplete={autoComplete} spellCheck={false} value={value} onChange={e=>onChange(e.target.value)} disabled={disabled} aria-describedby={hint?id+'-hint':undefined}/><button type='button' aria-label={(shown?'隐藏':'显示')+label} aria-pressed={shown} onClick={()=>setShown(!shown)} disabled={disabled}>{shown?<EyeOff size={16}/>:<Eye size={16}/>}<span>{shown?'隐藏':'显示'}</span></button></div>{hint&&<small id={id+'-hint'}>{hint}</small>}</div>;
}
function Feedback({error,notice}:{error?:string|null;notice?:string|null}){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(error){ref.current?.scrollIntoView({block:'nearest'});ref.current?.focus({preventScroll:true});}},[error]);
 return error?<div ref={ref} tabIndex={-1} className='security-feedback security-feedback--error' role='alert'><AlertCircle size={17}/><p>{error}</p></div>:notice?<div className='security-feedback security-feedback--success' role='status'><CheckCircle2 size={17}/><p>{notice}</p></div>:null;
}
function SecurityLink({children='去安全中心设置'}:{children?:string}){return <a className='button button--primary' href='#/security'>{children}</a>;}

function readErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return fallback;
}

export interface SecurityCenterProps {
  refresh: () => Promise<void>;
}

export function SecurityCenter({ refresh }: SecurityCenterProps) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const passwordHeadingId = `${baseId}-password-heading`;
  const deviceHeadingId = `${baseId}-device-heading`;
  const oldPwId = `${baseId}-old-password`;
  const newPwId = `${baseId}-new-password`;
  const confirmPwId = `${baseId}-confirm-password`;
  const deviceNameId = `${baseId}-device-name`;
  const devicePwId = `${baseId}-device-password`;
  const removePwId = `${baseId}-remove-password`;

  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);

  const [deviceName, setDeviceName] = useState('');
  const [devicePassword, setDevicePassword] = useState('');
  const [deviceBusy, setDeviceBusy] = useState<string | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [deviceNotice, setDeviceNotice] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removePassword, setRemovePassword] = useState('');

  const environment = deviceEnvironment('register');
  const configured = status?.passwordConfigured === true;
  const lockedUntil = status?.lockedUntil ?? 0;
  const locked = lockedUntil > Date.now();

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const next = await securityApi.status();
      setStatus(next);
      setLoadError(null);
    } catch (error) {
      setLoadError(readErrorMessage(error, '安全状态读取失败，请稍后重试。'));
    } finally {
      setLoading(false);
    }
  }, []);

  const syncStatus = useCallback(async () => {
    try {
      const next = await securityApi.status();
      setStatus(next);
      setLoadError(null);
    } catch (error) {
      setLoadError(readErrorMessage(error, '安全状态刷新失败，请重新读取核对。'));
    }
  }, []);

  const refreshQuietly = useCallback(async () => {
    try {
      await refresh();
    } catch {
      // 主状态刷新失败不影响安全操作结果，用户可稍后手动刷新核对。
    }
  }, [refresh]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingPassword) return;

    setPasswordError(null);
    setPasswordNotice(null);

    if (configured && oldPassword.length === 0) {
      setPasswordError('请输入当前交易密码后再设置新密码。');
      return;
    }

    const issue = passwordIssue(newPassword);
    if (issue) {
      setPasswordError(issue);
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的新密码不一致，请重新输入。');
      return;
    }

    setSavingPassword(true);
    try {
      const next = await securityApi.setPassword(newPassword, configured ? oldPassword : undefined);
      setStatus(next);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordNotice(
        configured
          ? '交易密码已修改，下次核验请使用新密码。'
          : '交易密码已设置。接下来请完成第 2 步设备验证，之后才能确认转账等操作。',
      );
      await refreshQuietly();
    } catch (error) {
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordError(readErrorMessage(error, '交易密码保存失败，请核对后重试。'));
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleRegisterDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deviceBusy !== null) return;

    setDeviceError(null);
    setDeviceNotice(null);

    if (!environment.supported) {
      setDeviceError(
        environment.hint ? `${environment.message}${environment.hint}` : environment.message,
      );
      return;
    }

    const name = deviceName.trim();
    if (name.length === 0 || name.length > 40) {
      setDeviceError('请填写 1–40 个字符的设备名称，便于之后识别是哪台设备。');
      return;
    }

    if (devicePassword.length === 0) {
      setDeviceError('请输入刚刚在本应用设置的交易密码，之后系统会弹出验证窗口。');
      return;
    }

    setDeviceBusy('register');
    try {
      await bindDevice({ name, password: devicePassword });
    } catch (error) {
      setDevicePassword('');
      setDeviceError(readErrorMessage(error, '设备验证设置未完成，请检查系统提示。'));
      await syncStatus();
      setDeviceBusy(null);
      return;
    }

    setDevicePassword('');
    setDeviceName('');
    setDeviceBusy(null);
    setDeviceNotice('设备验证已设置。回到 AI 助手，点击“查看并确认方案”，即可继续办理。');
    await syncStatus();
    await refreshQuietly();
  }

  async function handleRemoveDevice(deviceId: string) {
    if (deviceBusy !== null) return;

    setDeviceError(null);
    setDeviceNotice(null);

    if (removePassword.length === 0) {
      setDeviceError('删除设备需要输入交易密码。');
      return;
    }

    setDeviceBusy(deviceId);
    try {
      await securityApi.removeDevice(deviceId, removePassword);
    } catch (error) {
      setRemovePassword('');
      setDeviceError(readErrorMessage(error, '设备删除失败，请核对交易密码后重试。'));
      setDeviceBusy(null);
      return;
    }

    setRemovePassword('');
    setRemovingId(null);
    setDeviceBusy(null);
    setDeviceNotice('设备已删除，该设备不能再用于交易核验。');
    await syncStatus();
    await refreshQuietly();
  }

  const canRegister = configured && environment.supported && !locked && deviceBusy === null;

  return <section className='panel security-center' aria-labelledby={titleId} aria-busy={loading}>
    <header className='security-heading'><span className='security-symbol'><ShieldCheck size={22}/></span><div><h2 id={titleId}>安全中心</h2><p>完成下面两步，确认转账等操作时再由你本人授权。这里的设置只用于模拟环境。</p></div></header>
    <ol className='security-progress' aria-label='办理前的安全准备'><li data-done={configured}><span>1</span><div><strong>交易密码</strong><small>{status?(configured?'已设置':'待设置'):'读取中'}</small></div></li><li data-done={Boolean(status?.devices.length)}><span>2</span><div><strong>设备验证</strong><small>{status?.devices.length?`已设置 ${status.devices.length} 项`:!environment.supported?'当前页面暂不支持设置':'待设置'}</small></div></li></ol>
    <Feedback error={loadError}/>
    {locked&&<div className='security-callout' role='alert'>交易密码连续验证失败，请在 {formatTimestamp(lockedUntil)} 后重试。锁定期间无法确认办理。</div>}
    {!status?<div className='security-block'><p>{loading?'正在读取安全设置…':'暂时读不到安全设置，请重新连接后再试。'}</p>{!loading&&<button type='button' className='button button--ghost' onClick={()=>void loadStatus()}>重新读取</button>}</div>:<>
      <section className='security-block' aria-labelledby={passwordHeadingId}><div className='security-block-heading'><span>01</span><div><h3 id={passwordHeadingId}>{configured?'修改交易密码':'设置交易密码'}</h3><p>这是本应用的模拟交易密码，请不要填写真实银行卡密码，也不要发到聊天中。</p></div></div>
       <form className='security-form' onSubmit={handlePasswordSubmit} noValidate>
        {configured&&<div className='security-field-full'><PasswordField id={oldPwId} label='当前交易密码' value={oldPassword} onChange={setOldPassword} disabled={savingPassword}/></div>}
        <PasswordField id={newPwId} label='新交易密码' hint='8–64 个字符，需同时包含字母和数字' autoComplete='new-password' value={newPassword} onChange={setNewPassword} disabled={savingPassword}/>
        <PasswordField id={confirmPwId} label='再次输入新密码' hint='与刚才输入的新密码保持一致' autoComplete='new-password' value={confirmPassword} onChange={setConfirmPassword} disabled={savingPassword}/>
        <div className='security-form-footer'><Feedback error={passwordError} notice={passwordNotice}/><button className='button button--primary' type='submit' disabled={savingPassword} aria-busy={savingPassword}>{savingPassword?'正在保存…':configured?'保存新交易密码':'设置交易密码'}</button></div>
       </form>
      </section>
      <section className='security-block' aria-labelledby={deviceHeadingId}><div className='security-block-heading'><span>02</span><div><h3 id={deviceHeadingId}>设置设备验证</h3><p>确认办理时，电脑或手机会再弹出系统解锁窗口，确认是你本人操作。这一步不是再设置一个网页密码。</p></div></div>
       <ol className='security-instructions'><li><b>取个备注</b><span>例如“我的笔记本”，只是方便你识别。</span></li><li><b>输入交易密码</b><span>填写刚刚在本应用设置的密码。</span></li><li><b>按系统提示确认</b><span>弹窗可能要求指纹、人脸或设备 PIN，请按平时解锁设备的方式操作。</span></li></ol>
       {!environment.supported&&<div className='security-callout' role='alert'><strong>{environment.message}</strong><p>{environment.hint}</p></div>}
       {status.devices.length>0&&<div className='security-devices'><h4>已设置的验证方式</h4>{status.devices.map(device=><article key={device.id}><div className='security-device-row'><div><strong>{device.name}</strong><small>设置于 {formatTimestamp(Date.parse(device.createdAt))}</small></div><button type='button' className='button button--ghost' disabled={deviceBusy!==null} onClick={()=>{setRemovingId(device.id);setRemovePassword('');setDeviceError(null);setDeviceNotice(null);}}>移除</button></div>{removingId===device.id&&<div className='security-remove'><p>移除后不能再用这项验证确认办理。请保留至少一种可用方式，或稍后重新设置。</p><PasswordField id={removePwId} label='交易密码' value={removePassword} onChange={setRemovePassword} disabled={deviceBusy!==null}/><Feedback error={deviceError}/><div className='security-actions'><button type='button' className='button button--danger' disabled={deviceBusy!==null} onClick={()=>void handleRemoveDevice(device.id)}>{deviceBusy===device.id?'正在移除…':'确认移除'}</button><button type='button' className='button button--ghost' disabled={deviceBusy!==null} onClick={()=>{setRemovingId(null);setRemovePassword('');setDeviceError(null);}}>保留</button></div></div>}</article>)}</div>}
       {environment.supported&&<form className='security-form' onSubmit={e=>{setRemovingId(null);void handleRegisterDevice(e);}} noValidate>
        {!configured&&<p className='security-field-full security-inline-note'>请先完成第 1 步设置交易密码，再回来设置设备验证。</p>}
        <div className='security-field'><label htmlFor={deviceNameId}>验证方式备注</label><input id={deviceNameId} maxLength={40} autoComplete='off' placeholder='例如：我的笔记本' value={deviceName} onChange={e=>setDeviceName(e.target.value)} disabled={!canRegister}/><small>仅用于区分记录，不是账号或密码。</small></div>
        <PasswordField id={devicePwId} label='本应用交易密码' hint='下一步请在系统弹窗中验证' value={devicePassword} onChange={setDevicePassword} disabled={!canRegister}/>
        <div className='security-form-footer'>{!removingId&&<Feedback error={deviceError} notice={deviceNotice}/>}<button className='button button--primary' type='submit' disabled={!canRegister} aria-busy={deviceBusy==='register'}>{deviceBusy==='register'?'请在系统窗口完成验证…':'开始设置设备验证'}</button></div>
       </form>}
       <details className='security-more'><summary>验证方式与隐私说明</summary><p>{environment.message} 系统可能同步这项验证凭据，不一定只对应一台物理设备。更换访问网址后，原验证方式可能无法继续使用。</p></details>
      </section>
      <div className='security-return-note'>设置完成后，回到 AI 助手，点击方案卡片中的“查看并确认方案”继续。<a href='#/assistant'>回到 AI 助手 →</a></div>
    </>}
  </section>;
}

export interface TransactionRiskReason {
  code: string;
  title: string;
  detail: string;
}

export interface TransactionRisk {
  level: string;
  reasons: TransactionRiskReason[];
  note: string;
}

export interface TransactionGateProps {
  plan: Plan;
  disabled: boolean;
  onVerified: (pair: ProofPair) => Promise<void>;
  onVerifying?: (busy: boolean) => void;
  risk?: TransactionRisk;
}

function riskLabel(level: string): string {
  switch (level.toLowerCase()) {
    case 'high':
      return '高';
    case 'medium':
      return '中';
    case 'low':
      return '低';
    case 'normal':
      return '常规';
    default:
      return level;
  }
}

export function TransactionGate({ plan, disabled, onVerified, onVerifying, risk }: TransactionGateProps) {
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const passwordId = `${baseId}-password`;
  const ackId = `${baseId}-ack`;

  const [password, setPassword] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);

  const environment = deviceEnvironment();
  const registrationEnvironment = deviceEnvironment('register');
  const requireAck = (risk?.level ?? '').toLowerCase() === 'high';
  const lockedUntil = status?.lockedUntil ?? 0;
  const locked = lockedUntil > Date.now();
  const noDevices = status !== null && status.devices.length === 0;
  const hardBlocked = !environment.supported || noDevices || !statusLoaded || status===null || !status.passwordConfigured || locked;
  const cannotVerifyHere = !environment.supported || (noDevices && !registrationEnvironment.supported);
  const blockedEnvironment = !environment.supported ? environment : registrationEnvironment;

  useEffect(() => {
    let cancelled = false;
    securityApi
      .status()
      .then((next) => {
        if (cancelled) return;
        setStatus(next);
        setStatusLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setStatusLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [plan.id]);

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || disabled) return;

    setError(null);

    if (!environment.supported) {
      setError(environment.hint ? `${environment.message}${environment.hint}` : environment.message);
      return;
    }

    if (noDevices) {
      setError('还差一步设备验证。请先到安全中心设置，再回来确认这份方案。');
      return;
    }

    if (hardBlocked) {setError('请先完成安全准备，再回来确认办理。');return;}
    if (password.length === 0) {
      setError('请输入交易密码后再核验。');
      return;
    }

    if (requireAck && !acknowledged) {
      setError('请先勾选「我已核对风险线索、收款对象与用途」。');
      return;
    }

    setBusy(true);
    onVerifying?.(true);
    try {
      const pair = await verifyTransaction(plan.id, password, requireAck && acknowledged);
      await onVerified(pair);
    } catch (caught) {
      setError(readErrorMessage(caught, '核验未完成，计划未执行。'));
    } finally {
      setPassword('');
      setBusy(false);
      onVerifying?.(false);
    }
  }

  const passwordMissing=status!==null&&!status.passwordConfigured;
  const setupNeeded=passwordMissing||noDevices;
  return <form className='transaction-gate' onSubmit={handleVerify} noValidate aria-busy={busy} aria-labelledby={headingId}>
   <header><span className='security-symbol'><ShieldCheck size={19}/></span><div><h3 id={headingId}>最后一步：确认是你本人办理</h3><p>输入本应用交易密码，再按系统弹窗完成设备验证。两步都通过后才会执行。</p></div></header>
   {risk&&<details className='transaction-risk' open={requireAck}><summary>安全提醒 · {riskLabel(risk.level)}</summary>{risk.reasons.length>0?<ul>{risk.reasons.map(reason=><li key={reason.code}><strong>{reason.title}</strong>：{reason.detail}</li>)}</ul>:<p>暂未发现额外风险线索，仍请核对收款对象与用途。</p>}<p>这些提示用于帮助你核对，不代表交易一定安全。</p></details>}
   {cannotVerifyHere?<div className='security-callout' role='alert'><strong>{blockedEnvironment.message}</strong><p>{blockedEnvironment.hint} 这份方案尚未执行。</p><SecurityLink>查看安全设置与说明</SecurityLink></div>:!statusLoaded?<p className='security-inline-note' role='status'>正在检查安全准备…</p>:status===null?<div className='security-callout' role='alert'><strong>暂时读不到安全设置</strong><p>请先到安全中心重新读取，确认后再回来办理。这份方案尚未执行。</p><SecurityLink>检查安全设置</SecurityLink></div>:setupNeeded?<div className='security-callout' role='alert'><strong>{passwordMissing?'还没设置交易密码':'还差一步：设置设备验证'}</strong><p>{passwordMissing?'请先设置本应用的交易密码和设备验证。':'设备验证会在确认时弹出电脑或手机的解锁窗口。请先完成设置，再回来确认这份方案。'} 目前只是准备好了方案，还没有执行。</p><SecurityLink>{passwordMissing?'去设置交易密码与设备验证':'去设置设备验证'}</SecurityLink></div>:null}
   {locked&&<div className='security-callout' role='alert'>交易密码暂时锁定，请在 {formatTimestamp(lockedUntil)} 后重试。</div>}
   {!hardBlocked&&!disabled&&<div className='transaction-gate-fields'><PasswordField id={passwordId} label='本应用交易密码' value={password} onChange={setPassword} disabled={busy}/>{requireAck&&<label className='transaction-risk-ack' htmlFor={ackId}><input id={ackId} type='checkbox' checked={acknowledged} onChange={e=>setAcknowledged(e.target.checked)} disabled={busy}/><span>我已核对风险线索、收款对象与用途，确认继续办理。</span></label>}</div>}
   <Feedback error={error}/>
   {disabled?<p className='security-inline-note'>这份方案当前不能执行，请核对有效期或重新生成方案。</p>:<div className='transaction-gate-footer'>{!hardBlocked&&<><p>即将确认「{plan.title}」 · 预计资金变化 {money(plan.impactCents)}。取消系统验证不会执行方案。</p><button className='button button--primary' type='submit' disabled={busy} aria-busy={busy}>{busy?'正在等待验证与确认…':'验证并确认执行（模拟）'}</button></>}</div>}
  </form>;
}
