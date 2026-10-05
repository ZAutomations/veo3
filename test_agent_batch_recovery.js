const assert = require('assert');
const { failedBeforeMedia } = require('./agent_batch_recovery');
const prompt = 'Create six clips using the exact pending story. '.repeat(4);
const sample = () => ({agentOn:true, promptText:'', mediaTiles:{flow_video_tile:0,
    ready_video_tile:0,failed_video_tile:0,generating_video_tile:0}, conversationRows:[
    {role:'user', text:'Sarah George ' + prompt},
    {role:'agent', error:true, text:'Something went wrong. Please try again.'}]});
assert(failedBeforeMedia(sample(),prompt));
for (const field of ['flow_video_tile','ready_video_tile','failed_video_tile','generating_video_tile']) {
    const s=sample(); s.mediaTiles[field]=1; assert(!failedBeforeMedia(s,prompt));
}
const off=sample(); off.agentOn=false; assert(!failedBeforeMedia(off,prompt));
const wrong=sample(); wrong.conversationRows[0].text='An unrelated request';
assert(!failedBeforeMedia(wrong,prompt));
const queued=sample(); queued.conversationRows[1]={role:'agent',error:false,text:'Scheduled in the queue'};
assert(!failedBeforeMedia(queued,prompt));
const unknown=sample(); delete unknown.conversationRows; assert(!failedBeforeMedia(unknown,prompt));
console.log('Recovery checks passed: exact failed request only; existing, failed, queued, unknown media and unrelated requests block replay.');
