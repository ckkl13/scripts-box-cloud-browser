const OWNER="ckkl13",REPO="scripts-box-sync-storage",BRANCH="main",LIBRARY="3d08be0c5a525668",ROOT="scripts box";
let token="";
export function setToken(value){token=value.trim()}
function headers(){return token?{Authorization:"Bearer "+token,Accept:"application/vnd.github+json"}:{Accept:"application/vnd.github+json"}}
export async function api(path,options={}){const r=await fetch("https://api.github.com"+path,{...options,headers:{...headers(),...(options.headers||{})}});if(!r.ok)throw new Error("GitHub "+r.status+": "+await r.text());return r}
export async function readBytes(path,ref=BRANCH){const j=await (await api("/repos/"+OWNER+"/"+REPO+"/contents/"+path.split('/').map(encodeURIComponent).join('/')+"?ref="+encodeURIComponent(ref))).json();if(j.encoding!=="base64")throw new Error("GitHub 返回内容格式不支持");return Uint8Array.from(atob(j.content.replace(/\n/g,"")),c=>c.charCodeAt(0))}
export async function readManifest(){const bytes=await readBytes("libraries/"+LIBRARY+"/.scripts-box-sync/manifest.json.gz");const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));return JSON.parse(await new Response(stream).text())}
export function filePath(record){return "libraries/"+LIBRARY+"/files/"+ROOT+"/"+record.path}
export async function fileUrl(record){if(record.storage==="release"){const id=record.remote_ref.split(":").pop();const j=await (await api("/repos/"+OWNER+"/"+REPO+"/releases/assets/"+id)).json();return j.browser_download_url}const ref=record.remote_ref?.replace(/^git:/,"")||BRANCH;return "https://raw.githubusercontent.com/"+OWNER+"/"+REPO+"/"+ref+"/"+filePath(record)}
export async function fetchFile(record){const r=await fetch(await fileUrl(record),{headers:token?{Authorization:"Bearer "+token}:{}});if(!r.ok)throw new Error("文件读取失败（"+r.status+"）");return r}
