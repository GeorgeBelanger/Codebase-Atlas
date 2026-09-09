// Extra rendered fixtures cover historical overlays and the empty changes view.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const directory=path.resolve(process.argv[2]||'work/browser-smoke');
const demo=JSON.parse(fs.readFileSync(path.join(__dirname,'../examples/review-demo.data.json'),'utf8'));
for(const kind of ['historical','empty']){
  const d=structuredClone(demo),r=d.META.review;
  if(kind==='historical'){
    const n={...d.N[0],id:'retired',n:'Retired service',x:80,y:0,f:[['legacy/service.js',10]],copy:['RETIRED','Historical service','Former service','Removed from head'],group:d.G[d.N[0].g]};
    r.files.push({path:'legacy/service.js',status:'deleted',additions:0,deletions:10});
    r.removedNodes=[n];r.nodes.retired={status:'removed',files:['legacy/service.js']};
    r.edges=[{from:'retired',to:'payments',status:'removed'}];
  }else{r.files=[];r.nodes={};r.edges=[];r.removedNodes=[];r.unmapped=[];}
  const input=path.join(directory,`review-${kind}.json`),output=path.join(directory,`atlas-${kind}.html`);
  fs.writeFileSync(input,JSON.stringify(d));
  execFileSync('python3',[path.join(__dirname,'../scripts/build.py'),input,output],{stdio:'inherit'});
}
