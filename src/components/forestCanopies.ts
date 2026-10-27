// Crown locations in forest-v1.png (x, tip y, tree height, widest canopy).
// Geometry stays tied to the source photograph, so viewport crops do not
// change which parts are leaves and which parts are anchored lower trunks.
export const FOREST_CROWNS = [
  [90,220,360,105],[155,243,360,120],[237,330,290,100],
  [345,122,370,130],[433,109,360,105],[505,135,360,140],
  [606,219,310,115],[656,323,340,125],[791,118,340,120],
  [898,346,400,150],[997,345,300,110],[1125,333,360,160],
  [1220,409,380,160],[1337,108,400,150],[1426,272,350,140],
  [1530,64,370,120],[1598,352,320,130],[142,397,400,140],
  [359,405,390,150],[552,479,330,130],[940,438,350,140],
  [1115,426,400,150],[1178,617,310,170],[1345,728,300,150],
  [1463,622,330,170],[1630,767,300,170],[526,803,300,130],
  [683,751,270,130],[222,643,390,160],[304,649,350,180],
  [420,747,230,120],[19,518,370,140],[54,683,300,140],
  [196,-35,280,110],[360,-100,300,125],[519,-85,300,120],
  [978,-30,300,120],[1200,-30,300,125],[1420,-20,280,110],
] as const;

const smooth = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v-a)/(b-a)));
  return t*t*(3-2*t);
};

export function createForestCanopyMap() {
  const canvas = document.createElement('canvas');
  canvas.width=836; canvas.height=471;
  const context=canvas.getContext('2d')!;
  const pixels=context.createImageData(canvas.width,canvas.height);
  const gains=new Float32Array(canvas.width*canvas.height);
  const sx=1672/canvas.width,sy=941/canvas.height;
  // Back-to-front: a foreground crown may cover a distant tree's trunk.
  const ordered=[...FOREST_CROWNS].sort((a,b)=>a[1]-b[1]);
  for (const [cx,tip,height,width] of ordered) {
    const x0=Math.max(0,Math.floor((cx-width*.55)/sx)),x1=Math.min(canvas.width,Math.ceil((cx+width*.55)/sx));
    const y0=Math.max(0,Math.floor((tip-height*.035)/sy)),y1=Math.min(canvas.height,Math.ceil((tip+height*.57)/sy));
    for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++) {
      const depth=(y*sy-tip)/height;
      const halfWidth=width*.5*(.12+1.3*Math.max(0,depth));
      const side=Math.abs(x*sx-cx)/halfWidth;
      const crown=(1-smooth(.72,1.06,side))*smooth(-.035,.01,depth)*(1-smooth(.18,.56,depth));
      // Upper branches flex only slightly; outer foliage receives the breeze.
      const flexibility=.18+.82*smooth(.05,.34,side);
      gains[y*canvas.width+x]=Math.max(gains[y*canvas.width+x],crown*flexibility);
    }
    // Anchor this tree after its crown, while respecting foreground occlusion.
    const radius=Math.max(3,width*.045);
    const anchorStart=Math.max(0,Math.floor((tip+height*.48)/sy)),anchorEnd=Math.min(canvas.height,Math.ceil((tip+height)/sy));
    for(let y=anchorStart;y<anchorEnd;y++) for(let x=Math.max(0,Math.floor((cx-radius*1.6)/sx));x<Math.min(canvas.width,Math.ceil((cx+radius*1.6)/sx));x++) {
      gains[y*canvas.width+x]*=smooth(radius*.65,radius*1.6,Math.abs(x*sx-cx));
    }
  }
  for(let i=0;i<gains.length;i++) {
    pixels.data[i*4]=Math.round(gains[i]*255);
    pixels.data[i*4+3]=255;
  }
  context.putImageData(pixels,0,0);
  return canvas;
}
