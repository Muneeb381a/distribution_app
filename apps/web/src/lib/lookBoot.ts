/** Server-safe: the storage key, and the inline script that re-applies the saved look before first paint (no flash of default colours). */
export const LOOK_KEY = 'dist.look';
export const LOOK_BOOT = `try{var l=JSON.parse(localStorage.getItem('${LOOK_KEY}'));if(l){var r=document.documentElement;for(var k in l.attrs)r.setAttribute(k,l.attrs[k]);for(var v in l.vars)r.style.setProperty(v,l.vars[v])}}catch(e){}`;
