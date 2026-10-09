// Standalone Omni submission scheduler. UI/model selection stays in its own adapter.
const BATCH_SIZE=5;
const INTERVAL_MS=5000;
function groups(scenes){
    const result=[];
    for(let i=0;i<scenes.length;i+=BATCH_SIZE)result.push(scenes.slice(i,i+BATCH_SIZE));
    return result;
}
async function runQueue(scenes,{submit,waitForCompletion,sleep,checkpoint=async()=>{},whileGenerating=async()=>{},afterAll=async()=>{}}){
    if(!Array.isArray(scenes)||!scenes.length)throw Error('Select at least one scene.');
    let previous=[];
    for(const batch of groups(scenes)){
        const submitted=[];
        for(let i=0;i<batch.length;i++){
            if(i)await sleep(INTERVAL_MS);
            const receipt=await submit(batch[i]);
            if(!receipt)throw Error('Submission was not confirmed; queue stopped.');
            submitted.push(receipt);
            await checkpoint({phase:'submitted',scene:batch[i],receipt});
        }
        await whileGenerating(previous,batch);
        const result=await waitForCompletion(submitted);
        if(!result || result.ready!==submitted.length || result.failed || result.generating){
            throw Error('Omni group is incomplete or failed; no later prompts will be submitted.');
        }
        await checkpoint({phase:'completed',scenes:batch,receipts:submitted});
        previous=batch;
    }
    await afterAll(previous);
}
module.exports={BATCH_SIZE,INTERVAL_MS,groups,runQueue};
