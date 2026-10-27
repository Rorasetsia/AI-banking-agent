import { useEffect, useRef } from 'react';
import { createForestCanopyMap } from './forestCanopies';

// Animate the existing photograph in the browser; retain the CSS photo as fallback.
export function ForestWind() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const surface = canvas.current!;
    const gl = surface.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
    if (!gl) return;
    let stopped = false;
    let frame = 0;
    let last = 0;
    const started = performance.now();
    const vertex = gl.createShader(gl.VERTEX_SHADER)!;
    const fragment = gl.createShader(gl.FRAGMENT_SHADER)!;
    const program = gl.createProgram()!;
    const buffer = gl.createBuffer();
    const texture = gl.createTexture();
    const canopyTexture = gl.createTexture();
    gl.shaderSource(vertex, 'attribute vec2 position; varying vec2 uv; void main(){uv=position*.5+.5; gl_Position=vec4(position,0.,1.);}');
    gl.shaderSource(fragment, `precision highp float;
      varying vec2 uv;
      uniform sampler2D forest;
      uniform sampler2D canopies;
      uniform vec2 viewSize;
      uniform float time;
      void main(){
        float imageAspect=1672./941.;
        float viewAspect=viewSize.x/viewSize.y;
        vec2 cover=vec2(min(1.,viewAspect/imageAspect),min(1.,imageAspect/viewAspect));
        vec2 sampleUV=(uv-.5)*cover+vec2(.5,.5-.02*(1.-cover.y));
        // Wind travels across crowns, not the photograph as a whole.
        // The source-space map fixes lower trunks and tapers upper branches.
        float windDirection=mod(floor(time/5.),2.)<1.?1.:-1.;
        float windward=windDirection>0.?uv.x:1.-uv.x;
        float age=mod(time,5.)-windward*1.6;
        float gust=smoothstep(0.,.65,age)*(1.-smoothstep(1.,2.6,age));
        float flexibility=texture2D(canopies,sampleUV).r;
        float leafMotion=gust*flexibility;
        vec2 displacement=vec2(windDirection*leafMotion*.00125,0.);
        vec3 color=texture2D(forest,clamp(sampleUV-displacement,vec2(.002),vec2(.998))).rgb;
        gl_FragColor=vec4(color*(1.+leafMotion*.008),1.);
      }`);
    gl.compileShader(vertex); gl.compileShader(fragment);
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    const cleanup = () => {
      stopped = true; cancelAnimationFrame(frame);
      image.onload = null;
      gl.deleteTexture(texture); gl.deleteTexture(canopyTexture); gl.deleteBuffer(buffer); gl.deleteProgram(program);
      gl.deleteShader(vertex); gl.deleteShader(fragment);
      surface.removeEventListener('webglcontextlost', lost);
    };
    const lost = (event: Event) => { event.preventDefault(); surface.dataset.ready = 'false'; stopped = true; cancelAnimationFrame(frame); };
    surface.addEventListener('webglcontextlost', lost);
    const image = new Image();
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return cleanup;
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const time = gl.getUniformLocation(program, 'time');
    const size = gl.getUniformLocation(program, 'viewSize');
    gl.uniform1i(gl.getUniformLocation(program, 'forest'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'canopies'), 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D,canopyTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,createForestCanopyMap());
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE0);
    image.onload = () => {
      if (stopped) return;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const draw = (now: number) => {
        if (stopped) return;
        if (now-last >= 1000/30 && !document.hidden) {
          last = now;
          const scale = Math.min(1,1600/innerWidth);
          const width = Math.round(innerWidth*scale), height = Math.round(innerHeight*scale);
          if (surface.width !== width || surface.height !== height) { surface.width=width; surface.height=height; gl.viewport(0,0,width,height); }
          const elapsed = (now-started)/1000;
          gl.uniform2f(size,width,height); gl.uniform1f(time,elapsed);
          const direction = Math.floor(elapsed/5)%2===0 ? 'left' : 'right';
          if (surface.dataset.wind !== direction) surface.dataset.wind=direction;
          gl.drawArrays(gl.TRIANGLES,0,6);
          surface.dataset.ready='true';
        }
        frame=requestAnimationFrame(draw);
      };
      frame=requestAnimationFrame(draw);
    };
    image.src='/assets/forest-v1.png';
    return cleanup;
  }, []);
  return <canvas className="ph-forest-wind" ref={canvas} aria-hidden="true" data-ready="false" data-wind="left" />;
}
