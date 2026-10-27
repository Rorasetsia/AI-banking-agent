export type DevicePurpose = 'register' | 'authenticate';
export interface PolicyDocument {
  permissionsPolicy?: {allowsFeature:(name:string)=>boolean; features?:()=>string[]};
  featurePolicy?: {allowsFeature:(name:string)=>boolean; features?:()=>string[]};
}
export function policyPermission(doc: PolicyDocument | undefined, name: string): boolean | null {
  const policy=doc?.permissionsPolicy??doc?.featurePolicy;
  if(!policy)return null;
  try {
    if(policy.features&&!policy.features().includes(name))return null;
    return policy.allowsFeature(name);
  } catch {return null;}
}
export function evaluateDeviceEnvironment(input:{host:string;secure:boolean;browserSupported:boolean;permission:boolean|null;purpose:DevicePurpose}) {
  const {host,secure,browserSupported,permission,purpose}=input;
  if(['127.0.0.1','::1','[::1]'].includes(host))return {supported:false,host,level:'insecure-host' as const,message:'这个本地地址暂时不能完成设备验证。',hint:'请使用 http://localhost:端口 打开。两个地址的模拟账户独立，原设置不会自动迁移。'};
  if(!secure||!browserSupported)return {supported:false,host,level:'unsupported-browser' as const,message:'当前浏览器或页面暂时不能使用设备验证。',hint:'请使用新版 Chrome 或 Edge，通过 HTTPS 访问；本机体验可使用 localhost 地址。'};
  if(permission===false)return {supported:false,host,level:'blocked-by-page' as const,message:purpose==='register'?'当前预览页不允许新增设备验证。':'当前预览页不允许进行设备验证。',hint:'这不是交易密码输错。AI 对话、查看方案和账单仍可使用；若要确认办理，请联系项目团队提供支持设备验证的完整体验入口。'};
  return {supported:true,host,level:'ready' as const,message:'点击后会弹出系统验证窗口，请按平时解锁电脑或手机的方式确认。可能使用指纹、人脸或设备 PIN；应用不会收到你的指纹或人脸数据。'};
}
export function deviceFailureMessage(name:string,purpose:DevicePurpose,fallback:string) {
  const registering=purpose==='register';
  switch(name){
    case 'NotAllowedError':return {code:'DEVICE_CANCELLED' as const,message:registering?'设备验证还没设置完成：系统弹窗可能已取消、超时，或当前页面不允许设置。请检查系统提示后再试。':'设备验证被取消或超时，这份方案没有执行。确认要办理后，可以重新尝试。'};
    case 'AbortError':return {code:'DEVICE_CANCELLED' as const,message:registering?'设备验证设置已中断，没有添加新设备。':'设备验证已中断，这份方案没有执行。'};
    case 'InvalidStateError':return {code:'DEVICE_FAILED' as const,message:'这项设备验证可能已经设置过，请先核对设备列表，或在系统窗口选择其他验证方式。'};
    case 'NotSupportedError':return {code:'DEVICE_UNSUPPORTED' as const,message:'当前设备没有可用的验证方式，请先检查系统是否已设置解锁 PIN、指纹或人脸，或改用支持的浏览器。'};
    case 'SecurityError':return {code:'DEVICE_UNSUPPORTED' as const,message:'当前网址无法使用这项设备验证。请回到设置时使用的同一网址；如果正在使用内嵌预览页，请联系项目团队确认页面支持情况。'};
    default:return {code:'DEVICE_FAILED' as const,message:fallback};
  }
}
