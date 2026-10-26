'use strict';
// Re-render actual saved, redacted observations. Does not perform new network measurements.
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {saveReport}=require('../lib/report');
const {launchBrowser}=require('../lib/browser');
(async()=>{
  if(!process.argv[2])throw new Error('Pass an actual saved report.json path');
  const report=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
  delete report.score_model;delete report.score_input;delete report.score;
  const out=path.resolve('.artifacts/documented-report');await saveReport(report,out,{redact:true,command:'all'});
  const browser=await launchBrowser({installBrowser:false},()=>{});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:960}});await page.goto(pathToFileURL(path.join(out,'report.html')).href);
    await fs.mkdir('docs/images',{recursive:true});await page.screenshot({path:'docs/images/report-actual-redacted.png',fullPage:false});
    console.log('Captured actual saved observations with current scoring, redacted; no new measurements.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
