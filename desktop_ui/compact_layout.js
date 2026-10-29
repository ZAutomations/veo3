// Layout classes only: controls, event handlers and saved values are untouched.
(function(root){
 function apply(container,view){
  if(!container)return;
  container.classList.add('studio-compact','studio-card-grid');container.dataset.studioView=view;
  for(const form of container.querySelectorAll('form'))form.classList.add('studio-card-grid');
  for(const parent of [container,...container.querySelectorAll('form')]){
   for(const card of parent.children){
    card.classList.remove('studio-span-small','studio-span-wide','studio-span-full');
    if(card.matches('form,.page-heading,.hero,.stats,.workflow-cards,.section-head,.table-wrap,.action-bar,.settings-note,#story-detail')){
     card.classList.add('studio-span-full');continue;
    }
    if(!card.matches('.panel,details')){card.classList.add('studio-span-full');continue;}
    if(card.querySelector('.story-queue,.table-wrap,textarea[readonly]')){card.classList.add('studio-span-full');continue;}
    if(card.querySelectorAll('[data-browse="folder"]').length>6)card.classList.add('studio-folder-card');
    if(card.matches('.editing-captions')||card.querySelector('textarea,.editing-preview-stage,#reverse-video-list')){card.classList.add('studio-span-wide');continue;}
    if(card.querySelectorAll('input,select,textarea').length<=3)card.classList.add('studio-span-small');
   }
  }
 }
 root.StudioCompactLayout={apply};
})(typeof window==='undefined'?globalThis:window);
