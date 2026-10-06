let assetsPromise;
const clean=value=>Array.from(String(value??'')).filter(character=>{const code=character.codePointAt(0);return code>31&&code!==127||code===9||code===10||code===13}).join('').replace(/\r\n?/g,'\n').replace(/\t/g,'    ').replace(/[\u2013\u2014]/g,'-');
async function fileBase64(url){const response=await fetch(url);if(!response.ok)throw new Error('Could not load PDF asset');const bytes=new Uint8Array(await response.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary)}
function loadLibrary(){if(window.jspdf)return Promise.resolve();return new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/marketing-v70/vendor/jspdf.umd.min.js';script.onload=resolve;script.onerror=()=>{script.remove();reject(new Error('Could not load PDF tools'))};document.head.append(script)})}
async function loadAssets(){if(!assetsPromise)assetsPromise=Promise.all([loadLibrary(),fileBase64('/marketing-v70/assets/fonts/NotoSans-Regular.ttf'),fileBase64('/marketing-v70/assets/fonts/NotoSans-Bold.ttf'),fileBase64('/marketing-v70/assets/fp-logo.png')]).catch(error=>{assetsPromise=undefined;throw error});return assetsPromise}
export async function downloadDevelopmentPdf(data){
 const [,regular,bold,logo]=await loadAssets();
 const doc=new window.jspdf.jsPDF({unit:'mm',format:'a4',compress:true,putOnlyUsedFonts:true});
 doc.addFileToVFS('NotoSans-Regular.ttf',regular);doc.addFont('NotoSans-Regular.ttf','NotoSans','normal');
 doc.addFileToVFS('NotoSans-Bold.ttf',bold);doc.addFont('NotoSans-Bold.ttf','NotoSans','bold');
 doc.setProperties({title:'Player development - '+clean(data.player),author:'Football Player',subject:'Player development assessment',creator:'Football Player development form'});
 const ink=[16,31,57],muted=[77,94,120],blue=[41,101,255],line=[218,225,237];let y=0;
 function font(size=10,weight='normal',colour=ink){doc.setFont('NotoSans',weight);doc.setFontSize(size);doc.setTextColor(...colour)}
 function heading(first){
  doc.setFillColor(...ink);doc.rect(0,0,210,35,'F');doc.addImage('data:image/png;base64,'+logo,'PNG',18,8,18,18);
  font(15,'bold',[255,255,255]);doc.text('Football Player',42,16);font(9,'normal',[202,215,237]);doc.text('Player development',42,23);
  doc.setFillColor(...blue);doc.rect(0,35,210,1.2,'F');y=48;
  if(!first){font(10,'bold');const nameLines=doc.splitTextToSize(clean(data.player)+' | Assessment continued',174);doc.text(nameLines,18,y);y+=nameLines.length*5+8}
 }
 function nextPage(){doc.addPage();heading(false)}
 function ensure(height){if(y+height>270)nextPage()}
 function paragraph(text,{size=10,weight='normal',colour=ink,width=174,gap=4}={}){
  font(size,weight,colour);const lines=doc.splitTextToSize(clean(text),width),lineHeight=size*.3528*1.5;
  for(const textLine of lines){ensure(lineHeight);font(size,weight,colour);doc.text(textLine,18,y);y+=lineHeight}y+=gap;
 }
 function rule(){if(y>263){y=271;return}doc.setDrawColor(...line);doc.setLineWidth(.25);doc.line(18,y,192,y);y+=6}
 heading(true);paragraph('Player development report',{size:22,weight:'bold',gap:6});
 paragraph(data.player,{size:17,weight:'bold',colour:blue,gap:5});
 const date=String(data.date).split('-').reverse().join(':');
 const details=[['Assessment date',date],['Team or club',data.team||'Not entered'],['Coach',data.coach||'Not entered'],['Age group',data.age],['Player level',data.level],['Approach',data.approach]];
 for(let i=0;i<details.length;i+=2){font(9.5,'normal',muted);const left=doc.splitTextToSize(clean(details[i][0]+': '+details[i][1]),82),right=doc.splitTextToSize(clean(details[i+1][0]+': '+details[i+1][1]),82);const height=Math.max(left.length,right.length)*5.3+3;ensure(height);font(9.5,'normal',muted);doc.text(left,18,y);doc.text(right,110,y);y+=height}y+=4;rule();
 data.fields.forEach((field,index)=>{
  font(12,'bold');const label=String(index+1).padStart(2,'0')+'  '+clean(field.name),labelLines=doc.splitTextToSize(label,174);
  ensure(labelLines.length*6.4+20);paragraph(label,{size:12,weight:'bold',colour:blue,gap:3});
  const answer=field.value.trim()?field.value+(field.type==='Score 1 to 10'?' / 10':''):'Not entered';
  paragraph(answer,{size:10.5,colour:field.value.trim()?ink:muted,gap:4});rule();
 });
 const count=doc.getNumberOfPages();
 for(let page=1;page<=count;page++){
  doc.setPage(page);doc.setDrawColor(...line);doc.line(18,279,192,279);font(8,'normal',muted);doc.text('Created with Football Player | footballplayer.online',18,286);doc.text(page+' / '+count,192,286,{align:'right'});
 }
 const slug=data.player.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').slice(0,60)||'player';
 doc.save('Football-Player-'+slug+'-'+String(data.date).split('-').reverse().join('-')+'.pdf');
}
