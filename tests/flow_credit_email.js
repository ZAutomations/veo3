const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),M=require('../account_manager'),C=require('../flow_credits');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'credit-profile-')),original=M.profileDir;
try{
 M.profileDir=()=>dir;fs.mkdirSync(path.join(dir,'Default'));
 const file=path.join(dir,'Default','Preferences');fs.writeFileSync(file,JSON.stringify({account_info:[{email:'ProfileName@gmail.com'}]}));
 const account={label:'ProfileName',email:'ProfileName'};
 assert.equal(C.accountEmail(account),'profilename@gmail.com');
 assert.equal(account.email,'ProfileName','read-only resolution cannot prematurely overwrite saved identity');
 assert.throws(()=>C.storeReading({accounts:[account]},'ProfileName',{email:'other@gmail.com',balance:50}),/identity changed/);
 C.storeReading({accounts:[account]},'ProfileName',{email:'profilename@gmail.com',balance:87});
 assert.equal(account.email,'profilename@gmail.com');assert.equal(account.flow_credits.remaining,87);
 assert.equal(C.selectReading([{text:'87 Google Flow credits',href:'https://accounts.google.com/AccountChooser?Email=%20ProfileName%40gmail.com%20'}],'profilename@gmail.com').balance,87);
 assert.throws(()=>C.accountEmail({email:'different'}),/not a full Google email/);
 fs.writeFileSync(file,JSON.stringify({account_info:[{email:'same@gmail.com'},{email:'same@example.com'}]}));
 assert.throws(()=>C.accountEmail({email:'same'}),/could not be verified/);
 console.log('PASS: legacy username binds to one matching signed-in Chrome identity; full email saved only after matching live balance; mismatches/ambiguous profiles refused.');
}finally{M.profileDir=original;fs.rmSync(dir,{recursive:true,force:true});}
