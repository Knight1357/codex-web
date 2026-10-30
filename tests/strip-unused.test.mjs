import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripUnused } from '../scripts/strip-unused.mjs';

test('disabled pages preserve exports without executing original side effects; stripping is repeatable',async()=>{
 const root=await mkdtemp(join(tmpdir(),'codex-cleanup-'));
 try {
  await mkdir(join(root,'webview/assets'),{recursive:true});
  await mkdir(join(root,'.vite/build'),{recursive:true});
  await writeFile(join(root,'package.json'),'{"type":"module"}');
  const page=join(root,'webview/assets/library-page-fixture.js');
  await writeFile(page,'throw Error("disabled product was executed"); const Page=()=>42; export {Page as default, Page as route};');
  const core=join(root,'webview/assets/app-initial-fixture.js');
  await writeFile(core,'async function H9n(){throw Error("pets called")} function $on(){throw Error("referrals called")} export {H9n,$on};');
  await stripUnused(root);
  const module=await import(pathToFileURL(page));
  assert.equal(module.default(),null); assert.equal(module.route(),null);
  const api=await import(pathToFileURL(core));
  assert.deepEqual(await api.H9n(),[]); assert.equal(api.$on().enabled,false);
  const before=await readFile(page,'utf8'); await stripUnused(root);
  assert.equal(await readFile(page,'utf8'),before);
 } finally {await rm(root,{recursive:true,force:true});}
});
