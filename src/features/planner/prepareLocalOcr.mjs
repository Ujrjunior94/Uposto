// Build-time assets: recognition stays on the device, without third-party CDN calls.
import { mkdir, copyFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require=createRequire(import.meta.url);
const out=join(process.cwd(),'public/ocr');await mkdir(out,{recursive:true});
await copyFile(require.resolve('tesseract.js/dist/worker.min.js'),join(out,'worker.min.js'));
const core=dirname(require.resolve('tesseract.js-core/package.json'));
for(const name of await readdir(core))if(/lstm\.wasm(?:\.js)?$/.test(name))await copyFile(join(core,name),join(out,name));
const data=dirname(require.resolve('@tesseract.js-data/eng/package.json'));
await copyFile(join(data,'4.0.0_best_int/eng.traineddata.gz'),join(out,'eng.traineddata.gz'));
await copyFile(require.resolve('tesseract.js/LICENSE.md'),join(out,'TESSERACT-LICENSE.txt'));
await copyFile(join(core,'LICENSE'),join(out,'CORE-LICENSE.txt'));
