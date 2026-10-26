'use strict';
// Maintainer migration for the original v2 target list; does not probe websites.
const fs=require('node:fs');
const YAML=require('yaml');
const file=require('node:path').join(__dirname,'../domains.yaml'),data=YAML.parse(fs.readFileSync(file,'utf8'));
const groups={AI:['ChatGPT','Claude','Perplexity','Gemini','Grok','Hugging Face','OpenRouter','Poe'],search:['Google Scholar','Google Search','Bing Search'],developer:['GitHub','Stack Overflow','Vercel','Cloudflare'],social:['Instagram','X','Reddit','Discord','Medium','Quora','TikTok'],video:['Netflix','Disney+','Twitch','Spotify'],academic:['ScienceDirect','ResearchGate','JSTOR','arXiv'],finance:['PayPal','Stripe'],mail:['Gmail','Outlook','Proton Mail']};
for(const entry of [{name:'Gmail',url:'https://mail.google.com/'},{name:'Outlook',url:'https://outlook.live.com/mail/'},{name:'Proton Mail',url:'https://mail.proton.me/'}])if(!data.domains.some(x=>x.name===entry.name))data.domains.push(entry);
const expected={'Google Search':['Google'],'Bing Search':['Bing'],'X':['Happening now','Join X','Sign in to X','Twitter'],'Disney+':['Disney'],'Hugging Face':['Hugging Face'],'Gmail':['Google','Gmail'],'Outlook':['Outlook','Microsoft'],'Proton Mail':['Proton']};
const allowed={Claude:['claude.com'],Gmail:['accounts.google.com'],Outlook:['login.live.com'],Notion:['notion.com']};
for(const site of data.domains){site.category=Object.entries(groups).find(([,names])=>names.includes(site.name))?.[0]||'general';site.expected_text=expected[site.name]||[site.name];site.allowed_hosts=allowed[site.name]||[];site.timeout=12;}
fs.writeFileSync(file,YAML.stringify({version:'websites-v1',updated_at:'2026-10-27',expires_at:'2027-04-27',domains:data.domains}));
console.log(JSON.stringify({rules:'websites-v1',sites:data.domains.length,categories:[...new Set(data.domains.map(x=>x.category))]}));
