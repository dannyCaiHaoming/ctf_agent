// Manual re-learning of failed episodes on a COPY of an experience store. The source files are never opened for writing.
// Without an explicit budget (--max-tokens and --wall-ms) nothing is requested: the script only reports the planned requests.
// Usage: npx tsx tests/manual/relearn-episodes.ts --db <experience.sqlite> --out <new dir> --episodes <id[,id]> --profile <release-profile.json> [--max-tokens N --wall-ms N]
import {copyFile,mkdir,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadOpenCodeConfig} from '@ctf/opencode-bridge';
import {ExperienceStore,type Episode} from '../../apps/launcher/src/experience-store.js';
import {learnEpisodes,modelOutputLimit} from '../../apps/launcher/src/episode-learning.js';
import {loadReleaseProfile} from '../../apps/cli/src/composition/releaseProfile.js';
import {loadLocalEnv} from '../../apps/cli/src/composition/localEnv.js';

const sha=async(p:string)=>createHash('sha256').update(await readFile(p)).digest('hex');
/** Copy the database (with WAL side files) into `out`, reset the named failed episodes on the copy only. */
export async function prepareRelearn(db:string,out:string,ids:string[],outputLimit:number,secrets:readonly string[]=[]) {
  const source=resolve(db),copy=join(resolve(out),'experience.sqlite');
  await mkdir(resolve(out),{recursive:true,mode:0o700});
  if(existsSync(copy))throw new Error('output copy already exists: '+copy);
  for(const suffix of ['','-wal','-shm'])if(existsSync(source+suffix))await copyFile(source+suffix,copy+suffix);
  const store=new ExperienceStore(copy,secrets),episodes:Episode[]=[],skipped:Array<{id:string;reason:string}>=[];
  for(const id of ids) {
    const e=store.getEpisode(id);
    if(!e){skipped.push({id,reason:'not found'});continue;}
    if(e.episode_status==='failed'){e.episode_status='pending';e.lesson_status='pending';}
    else if(e.episode_status==='completed'&&e.lesson_status==='failed')e.lesson_status='pending';
    else {skipped.push({id,reason:`not a failed state: ${e.episode_status}/${e.lesson_status}`});continue;}
    delete e.error;store.saveEpisode(e);episodes.push(e);
  }
  // Estimate only: reservation per request is input allowance (prompt bytes + 4096) plus the output limit.
  const plan=episodes.map(e=>{
    const phases=e.episode_status==='pending'?['episode','lesson']:['lesson'];
    const bytes=e.episode_status==='pending'?Buffer.byteLength(JSON.stringify(e.model_input??{}))+3000:Buffer.byteLength(JSON.stringify(e.content??{}))+1500;
    return {id:e.episode_id,version:e.version,requests:phases.length,estimated_reserved_tokens:phases.length*(bytes+4096+outputLimit)};
  });
  return {store,copy,episodes,skipped,plan,requests:plan.reduce((n,p)=>n+p.requests,0),estimated_reserved_tokens:plan.reduce((n,p)=>n+p.estimated_reserved_tokens,0)};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const arg=(k:string)=>{const i=process.argv.indexOf('--'+k);return i>=0?process.argv[i+1]:undefined;};
  const db=arg('db'),out=arg('out'),ids=(arg('episodes')??'').split(',').filter(Boolean),profilePath=arg('profile');
  if(!db||!out||!ids.length||!profilePath){console.error('usage: --db <experience.sqlite> --out <dir> --episodes <id,...> --profile <release-profile.json> [--max-tokens N --wall-ms N]');process.exit(2);}
  await loadLocalEnv();
  const profile=await loadReleaseProfile(profilePath),loaded=await loadOpenCodeConfig(profile.opencode.configPath);
  const before=await sha(resolve(db)),prepared=await prepareRelearn(db,out,ids,modelOutputLimit(loaded.config),loaded.secrets);
  const maxTokens=Number(arg('max-tokens')),wallMs=Number(arg('wall-ms')),explicit=Number.isFinite(maxTokens)&&maxTokens>0&&Number.isFinite(wallMs)&&wallMs>0;
  const summary:any={copy:prepared.copy,skipped:prepared.skipped,plan:prepared.plan,planned_requests:prepared.requests,estimated_reserved_tokens:prepared.estimated_reserved_tokens,model:loaded.config.model,budget:explicit?{maxObservableTokens:maxTokens,wallClockMs:wallMs}:'not given: no request sent'};
  if(explicit&&prepared.episodes.length) {
    const report=await learnEpisodes({store:prepared.store,episodes:prepared.episodes,directory:join(resolve(out),'learning'),config:loaded.config,environment:loaded.environment,binaryPath:profile.opencode.binaryPath,budget:{maxObservableTokens:maxTokens,wallClockMs:wallMs}});
    summary.result={status:report.status,requests:report.requests,usage:report.usage,episodes:report.episodes.map((x:any)=>({id:x.id,status:x.status,lesson_ids:x.lesson_ids,error:x.error,dropped_keys:x.dropped_keys}))};
  }
  prepared.store.close();
  summary.source_unchanged=(await sha(resolve(db)))===before;
  console.log(JSON.stringify(summary,null,2));
}
