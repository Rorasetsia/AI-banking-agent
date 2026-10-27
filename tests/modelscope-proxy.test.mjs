import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { adaptModelScopeRequest } from '../scripts/start-modelscope.mjs';
import { createApp } from '../server/server.mjs';

const origin = 'https://rorastesia-moss-banking-preview.ms.show';
const host = new URL(origin).host;
const ingress = 'studio-ing-pr-d-edsgpsvksd.cn-beijing-vpc.fcapp.run';
function request(headers = {}, peer = '21.0.0.1') {
  return { socket: { remoteAddress: peer }, headers: {
    host: ingress, 'x-fc-request-id': '1-abc-123',
    'x-forwarded-proto': 'https, https', 'x-forwarded-host': host,
    origin, ...headers,
  } };
}

test('observed ModelScope ingress supports both metadata variants and mapped peer', () => {
  for (const req of [request(), request({'x-forwarded-host': undefined, 'x-forwarded-proto':'https'}), request({}, '::ffff:21.0.0.1')]) {
    const originalOrigin=req.headers.origin;
    assert.equal(adaptModelScopeRequest(req, origin), true);
    assert.equal(req.headers.host, host);
    assert.equal(req.headers.origin, originalOrigin);
  }
});

const denied = [
  ['untrusted peer', {}, '127.0.0.1'],
  ['other network peer', {}, '21.0.0.2'],
  ['missing peer', {}, ''],
  ['wrong private ingress', {host:'other.cn-beijing-vpc.fcapp.run'}],
  ['ingress suffix spoof', {host:ingress+'.evil.example'}],
  ['ingress with port', {host:ingress+':7860'}],
  ['raw internal probe', {host:'21.0.14.229:7860','x-forwarded-host':undefined,'x-forwarded-proto':undefined}],
  ['missing FC request', {'x-fc-request-id':undefined}],
  ['empty FC request', {'x-fc-request-id':''}],
  ['malformed FC request', {'x-fc-request-id':'bad, token'}],
  ['conflicting forwarded host', {'x-forwarded-host':'evil.example'}],
  ['empty forwarded host', {'x-forwarded-host':''}],
  ['list forwarded host', {'x-forwarded-host':host+', evil.example'}],
  ['array forwarded host', {'x-forwarded-host':[host]}],
  ['forwarded host port', {'x-forwarded-host':host+':7860'}],
  ['missing forwarded protocol', {'x-forwarded-proto':undefined}],
  ['HTTP', {'x-forwarded-proto':'http'}],
  ['mixed protocol chain', {'x-forwarded-proto':'http, https'}],
  ['empty protocol hop', {'x-forwarded-proto':'https,'}],
  ['excessive protocol hops', {'x-forwarded-proto':'https,https,https,https,https'}],
  ['array protocol', {'x-forwarded-proto':['https']}],
];
for (const [name,headers,peer] of denied) test(`rejects ${name} without rewriting headers`, () => {
  const req=request(headers,peer); const before=structuredClone(req.headers);
  assert.equal(adaptModelScopeRequest(req,origin),false);
  assert.deepEqual(req.headers,before);
});

test('configured public origin must stay exact HTTPS on ms.show',()=>{
  for(const value of ['http://'+host,origin+'/path',origin+'/',origin+'?a=1','https://evil.example','https://u:p@'+host,origin+':7860','invalid']){
    const req=request();assert.equal(adaptModelScopeRequest(req,value),false);assert.equal(req.headers.host,ingress);
  }
});

test('host adapter never changes a foreign or missing browser Origin',()=>{
  for(const browserOrigin of ['https://evil.example',undefined]){
    const req=request({origin:browserOrigin});assert.equal(adaptModelScopeRequest(req,origin),true);assert.equal(req.headers.origin,browserOrigin);
  }
});

test('real HTTP server retains session isolation, CSRF and model requirements behind simulated ingress',async t=>{
  const app=createApp({dbPath:':memory:',apiKey:'',publicOrigin:origin,modelRequired:true});
  // Only the test supplies transport metadata; production reads the actual socket.
  let simulatedPeer='21.0.0.1';
  app.server.prependListener('request', req=>adaptModelScopeRequest({headers:req.headers,socket:{remoteAddress:simulatedPeer}},origin));
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(()=>app.close());
  const call=(path,{body,cookie,headers={},peer='21.0.0.1'}={})=>new Promise((resolve,reject)=>{
    simulatedPeer=peer;
    const h={...request().headers,...headers,...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})};
    for(const k of Object.keys(h))if(h[k]===undefined)delete h[k];
    const req=http.request({hostname:'127.0.0.1',port:app.server.address().port,path,method:body?'POST':'GET',headers:h},res=>{
      let raw='';res.on('data',b=>raw+=b);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(raw),cookie:res.headers['set-cookie']?.[0]}));
    });req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
  });
  const a=await call('/api/session'),b=await call('/api/session',{headers:{'x-forwarded-host':undefined,'x-forwarded-proto':'https'}});
  assert.equal(a.status,200);assert.equal(b.status,200);assert.match(a.cookie,/; Secure/);assert.match(a.cookie,/HttpOnly/);assert.notEqual(a.cookie.split(';')[0],b.cookie.split(';')[0]);
  const cookie=a.cookie.split(';')[0];
  const before=(await call('/api/state',{cookie})).data;
  for(const browserOrigin of [undefined,'https://evil.example']){
    const r=await call('/api/chat',{cookie,body:{text:'给林悦转100元'},headers:{origin:browserOrigin,'x-forwarded-origin':origin}});
    assert.equal(r.status,403);assert.equal(r.data.error.code,'FORBIDDEN_ORIGIN');
  }
  const after=(await call('/api/state',{cookie})).data;
  for(const key of ['account','transactions','plans','messages'])assert.deepEqual(after[key],before[key]);
  const chat=await call('/api/chat',{cookie,body:{text:'我今年要攒十万块'}});
  assert.equal(chat.status,503);assert.equal(chat.data.error.code,'MODEL_NOT_CONFIGURED');
  const wrongHost=await call('/api/session',{headers:{'x-forwarded-host':'evil.example'}});
  assert.equal(wrongHost.status,403);assert.equal(wrongHost.data.error.code,'FORBIDDEN_HOST');
  const wrongPeer=await call('/api/session',{peer:'127.0.0.1'});assert.equal(wrongPeer.status,403);
});
