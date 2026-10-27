import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server/server.mjs';
import { allowModelScopeFrame } from '../scripts/start-modelscope.mjs';
const origin='https://rorastesia-moss-banking-preview.ms.show';
const host=new URL(origin).host;
async function fixture(t,framed){
 const app=createApp({dbPath:':memory:',apiKey:'',publicOrigin:origin,modelRequired:true});
 if(framed)app.server.prependListener('request',(req,res)=>{if(req.headers.host===host)allowModelScopeFrame(res);});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const call=(path,body,cookie,browserOrigin=origin)=>new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port:app.server.address().port,path,method:body?'POST':'GET',headers:{host,...(body?{'content-type':'application/json',origin:browserOrigin}:{}),...(cookie?{cookie}:{})}},res=>{let raw='';res.on('data',b=>raw+=b);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,raw,data:(res.headers['content-type']||'').includes('json')?JSON.parse(raw):null}));});
  req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
 });return call;
}
test('ordinary hosted app keeps iframe DENY and Strict cookies',async t=>{
 const call=await fixture(t,false);const page=await call('/');assert.equal(page.headers['x-frame-options'],'DENY');assert.match(page.headers['content-security-policy'],/frame-ancestors 'none'/);
 const session=await call('/api/session');assert.match(session.headers['set-cookie'][0],/SameSite=Strict/);assert.doesNotMatch(session.headers['set-cookie'][0],/Partitioned/);
});
test('ModelScope HTML permits only official parents and preserves remaining CSP',async t=>{
 const call=await fixture(t,true);const page=await call('/');assert.equal(page.status,200);assert.equal(page.headers['x-frame-options'],undefined);
 const csp=page.headers['content-security-policy'];assert.match(csp,/frame-ancestors https:\/\/modelscope\.cn https:\/\/www\.modelscope\.cn(?:;|$)/);assert.match(csp,/connect-src 'self'/);assert.match(csp,/script-src 'self'/);assert.doesNotMatch(csp,/frame-ancestors \*/);
});
test('partitioned browser sessions retain isolation and exact POST Origin',async t=>{
 const call=await fixture(t,true);const a=await call('/api/session'),b=await call('/api/session');const cookie=a.headers['set-cookie'][0];
 assert.match(cookie,/SameSite=None/);assert.match(cookie,/Partitioned/);assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.doesNotMatch(cookie,/Domain=/i);assert.notEqual(cookie.split(';')[0],b.headers['set-cookie'][0].split(';')[0]);
 const sid=cookie.split(';')[0];assert.equal((await call('/api/state',undefined,sid)).status,200);
 const before=(await call('/api/state',undefined,sid)).data;
 const bad=await call('/api/chat',{text:'给林悦转100元'},sid,'https://www.modelscope.cn');assert.equal(bad.status,403);assert.equal(bad.data.error.code,'FORBIDDEN_ORIGIN');
 const after=(await call('/api/state',undefined,sid)).data;for(const k of ['account','transactions','messages','plans'])assert.deepEqual(after[k],before[k]);
 const correct=await call('/api/chat',{text:'我今年要攒十万块'},sid);assert.equal(correct.status,503);assert.equal(correct.data.error.code,'MODEL_NOT_CONFIGURED');
});
test('header objects, status reason, multi cookies and host-only session restrictions',async t=>{
 const server=http.createServer((req,res)=>{
  allowModelScopeFrame(res);
  res.setHeader('Content-Security-Policy',"default-src 'self'; frame-ancestors 'none'");
  res.writeHead(200,'OK',{'x-frame-options':'DENY','Set-Cookie':['sid=sample; Path=/; Domain=example.com; SameSite=Strict','other=value; SameSite=Strict']});res.end('ok');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const headers=await new Promise((resolve,reject)=>{http.get(`http://127.0.0.1:${server.address().port}`,res=>{res.resume();res.on('end',()=>resolve(res.headers));}).on('error',reject);});
 assert.equal(headers['x-frame-options'],undefined);assert.match(headers['content-security-policy'],/https:\/\/www\.modelscope.cn/);assert.doesNotMatch(headers['set-cookie'][0],/Domain=/i);assert.match(headers['set-cookie'][0],/Partitioned/);assert.equal(headers['set-cookie'][1],'other=value; SameSite=Strict');
});
