// Runs before React: take the one-time login token from the URL fragment into memory and clear the address bar.
// The token is never written to storage, logs or analytics; GET of this page never redeems it.
const TOKEN=/^#token=([A-Za-z0-9_-]{43,256})$/;
let token:string|null=null;
if(window.location.pathname==='/auth/connect'){
  const match=TOKEN.exec(window.location.hash);
  if(match)token=match[1]!;
  if(window.location.hash)window.history.replaceState(null,'',window.location.pathname);
}
/** Returns the token once; later calls get null so it cannot be reused by the page. */
export function takeConnectToken() {const value=token;token=null;return value;}
export const hasConnectToken=()=>token!==null;
