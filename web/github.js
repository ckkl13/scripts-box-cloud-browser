const OWNER="ckkl13",REPO="scripts-box-sync-storage",BRANCH="main",LIBRARY="3d08be0c5a525668",ROOT="scripts box";
let token="";
export function setToken(value){token=value.trim()}
function headers(){return token?{Authorization:`Bearer ${token}`,Accept:"application/vnd.github+json"}:{Accept:"application/vnd.github+json"}}
export async function api(path,options={}){const r=await fetch(`https://api.github.com${path}`,{...options,headers:{...headers(),...(options.headers||{})}});if(!r.ok)throw new Error(`GitHub ${r.status}: ${await r.text()}`);return r}
export async function readBytes(path,ref=BRANCH){const j=await (await api(`/repos/${OWNER}/${REPO}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`)).json();if(j.encoding!=="base64")throw new Error("GitHub 返回内容格式不支持");return Uint8Array.from(atob(j.content.replace(/\n/g,"")),c=>c.charCodeAt(0))}
export async function readText(path,ref=BRANCH){return new TextDecoder().decode(await readBytes(path,ref))}
export async function readManifest(onProgress=()=>{}){
  const path=`libraries/${LIBRARY}/.scripts-box-sync/manifest.json.gz`.split('/').map(encodeURIComponent).join('/');
  const r=await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}?ref=${encodeURIComponent(BRANCH)}`,{headers:{...headers(),Accept:'application/vnd.github.raw+json'}});
  if(!r.ok)throw new Error(`GitHub ${r.status}: ${await r.text()}`);
  const total=Number(r.headers.get('content-length'))||0;let loaded=0;const reader=r.body.getReader();const chunks=[];
  onProgress({loaded,total,phase:'downloading'});
  while(true){const part=await reader.read();if(part.done)break;chunks.push(part.value);loaded+=part.value.byteLength;onProgress({loaded,total,phase:'downloading'});}
  const bytes=new Uint8Array(loaded);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  onProgress({loaded,total,phase:'parsing'});
  const result=JSON.parse(await new Response(stream).text());onProgress({loaded:total||loaded,total:total||loaded,phase:'done'});return result;
}
export function filePath(record){return `libraries/${LIBRARY}/files/${ROOT}/${record.path}`}
export async function fileUrl(record){if(record.storage==="release"){const id=record.remote_ref.split(":").pop();const j=await (await api(`/repos/${OWNER}/${REPO}/releases/assets/${id}`)).json();return j.browser_download_url}const ref=record.remote_ref?.replace(/^git:/,"")||BRANCH;return `https://raw.githubusercontent.com/${OWNER}/${REPO}/${ref}/${filePath(record)}`}
export async function fetchFile(record){
  if(record.storage==='release'){
    const id=record.remote_ref.split(':').pop();
    const r=await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${id}`,{headers:{...headers(),Accept:'application/octet-stream'}});
    if(!r.ok)throw new Error(`文件读取失败（${r.status}）：${await r.text()}`);
    return r;
  }
  const ref=record.remote_ref?.replace(/^git:/,'')||BRANCH;
  const path=filePath(record).split('/').map(encodeURIComponent).join('/');
  const r=await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}?ref=${encodeURIComponent(ref)}`,{headers:{...headers(),Accept:'application/vnd.github.raw+json'}});
  if(!r.ok)throw new Error(`文件读取失败（${r.status}）：${await r.text()}`);
  return r;
}
export function repoUrl(path=""){return `https://github.com/${OWNER}/${REPO}/tree/${BRANCH}/${path}`}
export {OWNER,REPO,BRANCH,LIBRARY,ROOT}
