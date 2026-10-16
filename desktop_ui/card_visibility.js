// Collapse card bodies without removing controls or changing their values.
(function(root){
 function install(container,{view,states,onChange}){
  const document=container.ownerDocument,counts=new Map();
  for(const card of container.querySelectorAll('details,.panel,.table-wrap,.hero,.stats,#story-detail')){
   if(card.dataset.cardVisibility||!card.children.length)continue;
   if(card.tagName!=='DETAILS'&&card.closest('details'))continue;
   const details=card.tagName==='DETAILS';
   let header=details?card.querySelector(':scope > summary'):card.querySelector(':scope > .panel-title, :scope > .section-head');
   const label=details?header?.textContent.trim():header?.querySelector('h2')?.textContent.trim()||card.querySelector('h2')?.textContent.trim()||(card.classList.contains('table-wrap')?(view==='accounts'?'Accounts':'Stories'):card.classList.contains('stats')?'Overview counts':'Options');
   if(!label)continue;
   const base=`${view}|${card.tagName}|${label}`,index=counts.get(base)||0;counts.set(base,index+1);
   const key=base+'|'+index;
   card.dataset.cardVisibility=key;card.classList.add('card-collapsible');
   if(!header){header=document.createElement('div');header.className='card-heading';const title=document.createElement('span');title.textContent=label;header.append(title);card.prepend(header);}
   let body;
   if(!details){body=document.createElement('div');body.className='card-body';for(const child of [...card.childNodes])if(child!==header)body.append(child);card.append(body);}
   const button=document.createElement('button');button.type='button';button.className='button small card-visibility-toggle';header.append(button);
   const apply=collapsed=>{
    if(details)card.open=!collapsed;else body.hidden=collapsed;
    card.classList.toggle('card-collapsed',collapsed);
    button.textContent=collapsed?'Show':'Hide';button.setAttribute('aria-expanded',String(!collapsed));button.setAttribute('aria-label',`${collapsed?'Show':'Hide'} ${label}`);
   };
   const save=collapsed=>{states[key]=collapsed;onChange();};
   apply(typeof states[key]==='boolean'?states[key]:details?!card.open:false);
   button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();const collapsed=details?card.open:!body.hidden;apply(collapsed);save(collapsed);});
   if(details)card.addEventListener('toggle',()=>{const collapsed=!card.open;apply(collapsed);if(states[key]!==collapsed)save(collapsed);});
  }
 }
 root.StudioCardVisibility={install};
})(typeof window==='undefined'?globalThis:window);
