const assert=require('node:assert/strict');
const {finishedStoryDuration}=require('./mcp_server');
assert.equal(finishedStoryDuration(64,8,'3d-zack-style'),72);
assert.equal(finishedStoryDuration(32,8,'3d-zack-style'),40);
assert.equal(finishedStoryDuration(64,8,'relationship-dialogue-real'),64);
assert.equal(finishedStoryDuration(0,8,'3d-zack-style'),0);
assert.equal(finishedStoryDuration(25,8,'3d-zack-style'),32);
console.log('Passed: existing 72s Zack story matches 64s source + 8s CTA; other presets unchanged.');
