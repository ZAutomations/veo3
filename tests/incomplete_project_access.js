const assert=require('assert');const {assertProjectAccess}=require('../flow_project');
const url='https://flow.google.com/project/test-id';
assert.doesNotThrow(()=>assertProjectAccess(url,url));
for(const actual of ['https://flow.google.com/404?reason=project','https://accounts.google.com/ServiceLogin','https://flow.google.com/project/other'])assert.throws(()=>assertProjectAccess(actual,url),/RECOVERY_REVIEW_REQUIRED: FLOW_PROJECT_ACCESS_FAILED/);
console.log('Incomplete project access redirect guards passed');
