'use strict';
const fs=require('fs'),path=require('path');
const START='[BEGIN COMPLETE STORY PACKAGE DELIVERY V3]',END='[END COMPLETE STORY PACKAGE DELIVERY V3]';
function sourceStandard(id=''){
 if(/cats|cat-|animal|dog/.test(id))return 'Animal topics: primary animal-behaviour research, veterinary universities, recognized animal welfare organizations and reputable veterinary guidance; match species and actual claim.';
 if(/space/.test(id))return 'Space Documentary: NASA, ESA, national observatories, original mission data and peer-reviewed astronomy/planetary-science papers. Distinguish measurements from models and hypotheses.';
 if(/geography|3d-map|travel/.test(id))return 'Geography Map: national mapping agencies, geological surveys, official transport/port authorities, original historical records and reliable geographical research. Verify places, dates, quantities and territorial claims; distinguish historical from current boundaries.';
 if(/fern|crime|history|politics|conspiracy|mafia|wolf/.test(id))return 'Documentary/history/politics: primary archives, court records, government documents, official statistics, contemporary records and corroborated reputable reporting. Distinguish documented facts, allegations and analysis; verify changing events as of the stated date. Clearly label fictional stories and never invent archival evidence for them.';
 if(/health|zack|science|3d-explainer/.test(id))return 'Science/health explainers: primary research, recognized medical/public-health institutions, relevant professional bodies, official engineering documentation and original manufacturer/mechanism references. Match the actual topic; distinguish evidence, uncertainty and myths without exaggeration.';
 return 'Use reliable sources specific to this preset and the selected story: prefer primary research, official institutions and original documents. Preserve fictional/entertainment status where applicable; do not invent factual support, URLs or studies. Never use feline/veterinary sources for an unrelated niche.';
}
function block(id){return START+'\n'+fs.readFileSync(path.join(__dirname,'master_prompt_package_contract_v3.txt'),'utf8').trim()+'\n\nNICHE-SPECIFIC SOURCE STANDARD\n'+sourceStandard(id)+'\n'+END;}
function apply(text,id){
 const start=text.indexOf(START);
 if(start>=0){const end=text.indexOf(END,start);if(end<0)throw Error('Incomplete V3 package contract; refusing to remove unrelated prompt content.');text=text.slice(0,start)+text.slice(end+END.length);}
 return text.trimEnd()+'\n\n'+block(id)+'\n';
}
module.exports={START,END,block,apply,sourceStandard};
