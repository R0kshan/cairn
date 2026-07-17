import { readFileSync, readdirSync } from 'node:fs';
import { parse } from './src/parse.ts';
import { validate } from './src/validate.ts';
import { layout } from './src/layout.ts';
import { render } from './src/render.ts';
import { views, themeNames } from './src/model.ts';
const files=readdirSync('examples').filter(f=>f.endsWith('.cairn')&&f!=='broken.cairn').map(f=>'examples/'+f);
for(const th of themeNames){
  let over=0,err=0;
  for(const p of files){try{const raw=readFileSync(p,'utf8').replace(/\r\n/g,'\n');const l=raw.split('\n');l.splice(1,0,`style { theme: ${th} }`);const {model}=parse(l.join('\n'));validate(model);const s=await layout(model,views[model.type]);const{overlapsAfter}=render(model,views[model.type],s);if(overlapsAfter)over++;}catch(e){err++;}}
  console.log(`  ${th.padEnd(14)} overlaps:${over} errors:${err}`);
}
// accent test
const raw=readFileSync('examples/application.cairn','utf8').replace(/\r\n/g,'\n');const l=raw.split('\n');l.splice(1,0,'style { accent: #17876b }');const {model}=parse(l.join('\n'));validate(model);const s=await layout(model,views.application);const {svg}=render(model,views.application,s);
console.log('  accent applied to flows?', /stroke="#17876b"/.test(svg));
