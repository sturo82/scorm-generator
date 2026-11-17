import { readFileSync } from 'node:fs';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { autoDirection } from '../../apps/api/dist/slides/slide-direction.js';
const D='/home/sturo/repos/scorm-generator/corso_juve/prova';
const spec0 = JSON.parse(readFileSync(D+'/spec-split.json','utf8'));
const texts = ['CHILD SAFEGUARDING POLICY','1 INTRODUCTION', readFileSync('/dev/null','utf8'), ''];
const dir = autoDirection(spec0.slides.map((s,i)=>({ index:i+1, text: i===2 ? 'x '.repeat(67) : i===3 ? 'x '.repeat(45) : texts[i], png: readFileSync(`${D}/p-0${i+1}.png`) })));
console.log(dir);
const spec = { ...spec0, layout:'dynamic', burnCaptions:false, sectionTitle:'Introduzione', theme:{ bg:'#0b0f14', accent:'#f5b700', text:'#ffffff' },
  slides: spec0.slides.map((s,i)=>({ ...s, shot: ['presenter','presenter','focus','side'][i], pipPosition: ['top-left','bottom-left','bottom-left','top-right'][i] })) };
const serveUrl = await bundle({ entryPoint: new URL('./dist/remotion-entry.js', import.meta.url).pathname });
const inputProps={spec};
const comp=await selectComposition({serveUrl,id:'SlideAvatarVideo',inputProps});
console.log('frames',comp.durationInFrames);
const e=[0,409,625,1235]; // inizi slide (approx)
for (const f of [640, 652, 664, 700, 1190, 1222, 1240, 1300]) await renderStill({composition:comp,serveUrl,inputProps,frame:f,output:`/tmp/rt/dyn-${f}.png`});
const t=Date.now();
await renderMedia({composition:comp,serveUrl,codec:'h264',outputLocation:'/home/sturo/repos/scorm-generator/corso_juve/prova/dinamico.mp4',inputProps});
console.log('render s', Math.round((Date.now()-t)/1000));
