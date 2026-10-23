import {execFileSync} from 'node:child_process';
/** The tag endpoint may omit drafts; authenticated release listings include them. */
export function findGithubRelease(repo,tag){
  const pages=JSON.parse(execFileSync('gh',['api',`repos/${repo}/releases?per_page=100`,'--paginate','--slurp'],{encoding:'utf8'}));
  return pages.flat().find(r=>r.tag_name===tag);
}
export function releaseById(repo,id){
  if(!Number.isSafeInteger(id)||id<=0)throw Error('GitHub 发布 ID 无效');
  return JSON.parse(execFileSync('gh',['api',`repos/${repo}/releases/${id}`],{encoding:'utf8'}));
}
