'use strict';
async function read(page,image){
 // This helper is called only on a disposable inspection tab. Reuse copies
 // metadata into its editor; no submit/generate button is ever pressed.
 const editor=await page.$('.ProseMirror');
 if(editor){try{await editor.focus();await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.press('Backspace');}finally{await editor.dispose();}}
 const clicked=await page.evaluate(source=>{
  const hits=[...document.querySelectorAll('flow-image-tile')].filter(t=>[...t.querySelectorAll('img')].some(im=>(im.currentSrc||im.src)===source));
  if(hits.length!==1)return false;
  const button=hits[0].querySelector('button[aria-label="Reuse prompt"]');
  if(!button||button.disabled)return false;button.click();return true;
 },image.key);
 if(!clicked)return '';
 try{await page.waitForFunction(()=>!!document.querySelector('.ProseMirror')?.innerText?.trim(),{timeout:10000});}
 catch{return '';}
 return page.evaluate(()=>document.querySelector('.ProseMirror')?.innerText||'');
}
module.exports={read};
