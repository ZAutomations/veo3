const assert=require('assert'),fs=require('fs'),path=require('path'),puppeteer=require('puppeteer');
(async()=>{const browser=await puppeteer.launch({headless:true});try{const page=await browser.newPage(),errors=[],jobs=[];page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
 page.on('request',async req=>{const url=new URL(req.url());if(url.pathname.startsWith('/assets/'))return req.respond({status:200,contentType:url.pathname.endsWith('.js')?'text/javascript':'text/css',body:fs.readFileSync(path.join(__dirname,'../desktop_ui',path.basename(url.pathname)))});
 if(url.pathname==='/')return req.respond({status:200,contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'../desktop_ui/index.html'),'utf8').replace('__SESSION_TOKEN__','test')});
 let data={};if(url.pathname==='/api/bootstrap')data={defaults:{},presets:[],models:[],preferences:{theme:'lime',current:'reverse',forms:{}},workflowDefaults:{}};
 if(url.pathname==='/api/accounts')data={accounts:[]};if(['/api/library','/api/reverse-runs'].includes(url.pathname))data=[];
 if(url.pathname==='/api/jobs'){if(req.method()==='POST'){jobs.push(JSON.parse(req.postData()));data={id:'reverse-job'};}else data=[];}
 if(url.pathname==='/api/jobs/reverse-job')data={status:'running',lane:'writer',cursor:0,logs:[]};
 return req.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});});
 await page.goto('http://studio.local/');await page.waitForSelector('#reverse-add');assert.equal(await page.$$eval('#navigation [data-view]',n=>n.length),10);
 await page.evaluate(()=>{window.pywebview={api:{choose_file:async()=>`D:\\reference-${reverseVideos().length}.mp4`}};});
 for(let i=0;i<3;i++){await page.click('#reverse-add');await page.waitForFunction(n=>reverseVideos().length===n,{timeout:3000},i+1).catch(async e=>{console.error(await page.evaluate(()=>({toast:document.querySelector('#toast').textContent,refs:reverseVideos()})));throw e;});}
 await page.click('#reverse-add');assert.equal(await page.evaluate(()=>reverseVideos().length),3);
 await page.type('#reverseName','My animation');await page.$eval('#reverse-analyze',el=>el.scrollIntoView({block:'center'}));await page.click('#reverse-analyze');await page.waitForFunction(()=>document.querySelector('#activity').classList.contains('expanded'),{timeout:3000}).catch(async e=>{console.error('Analyze failure',errors,await page.evaluate(()=>({toast:document.querySelector('#toast').textContent,html:document.querySelector('#reverse-analyze').outerHTML})));throw e;});
 assert.equal(jobs.length,1);assert.equal(jobs[0].action,'reverse_video');assert.equal(jobs[0].payload.view,'reverse');assert.equal(jobs[0].payload.reverseClips,'8');assert.equal(jobs[0].payload.reverseName,'My animation');assert.equal(jobs[0].payload.videos.length,3);
 assert.deepEqual(errors,[]);console.log('PASS: new tab, three-video attachment limit, complete job settings and no browser errors.');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
