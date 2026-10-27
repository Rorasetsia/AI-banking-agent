import test from 'node:test';import assert from 'node:assert/strict';
import {policyPermission,evaluateDeviceEnvironment,deviceFailureMessage} from '../src/security-environment.ts';
const ready={host:'preview.example.cn',secure:true,browserSupported:true,permission:null,purpose:'register'};
test('新增与已有设备验证权限分别检查，未知权限不冒充禁止',()=>{
 const doc={featurePolicy:{features:()=>['publickey-credentials-create','publickey-credentials-get'],allowsFeature:key=>key.endsWith('-get')}};
 assert.equal(policyPermission(doc,'publickey-credentials-create'),false);assert.equal(policyPermission(doc,'publickey-credentials-get'),true);
 assert.equal(policyPermission({},'publickey-credentials-create'),null);
 assert.equal(policyPermission({featurePolicy:{features:()=>[],allowsFeature:()=>false}},'publickey-credentials-create'),null);
 assert.equal(policyPermission({featurePolicy:{allowsFeature:()=>{throw new Error('unsupported');}}},'publickey-credentials-create'),null);
 assert.equal(evaluateDeviceEnvironment(ready).supported,true);
 assert.equal(evaluateDeviceEnvironment({...ready,permission:false}).level,'blocked-by-page');
 assert.equal(evaluateDeviceEnvironment({...ready,permission:true,purpose:'authenticate'}).supported,true);
});
test('公网HTTPS与localhost正常，非安全环境与127地址提供准确指引',()=>{
 assert.equal(evaluateDeviceEnvironment({...ready,host:'localhost'}).supported,true);
 for(const changes of [{host:'127.0.0.1'},{secure:false},{browserSupported:false}])assert.equal(evaluateDeviceEnvironment({...ready,...changes}).supported,false);
 const remote=evaluateDeviceEnvironment({...ready,permission:false});assert.match(remote.hint,/不是交易密码输错/);assert.doesNotMatch(remote.hint,/localhost/);
});
test('注册取消与交易取消不混淆，也不把远端错误都归因于localhost',()=>{
 const register=deviceFailureMessage('NotAllowedError','register','fallback');assert.match(register.message,/设置/);assert.doesNotMatch(register.message,/本次交易未执行/);
 const verify=deviceFailureMessage('NotAllowedError','authenticate','fallback');assert.match(verify.message,/方案没有执行/);
 assert.doesNotMatch(deviceFailureMessage('SecurityError','register','fallback').message,/localhost/);
 assert.equal(deviceFailureMessage('unknown','register','已取消').message,'已取消');
});
