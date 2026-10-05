/* eslint-disable */
/* Ported trusted v70 reference; DOM and lifecycle access are scoped by React. */
export default function mountReference(scope) {
const developmentPdfUrl = '/marketing-v70/development-pdf.js';
const { document, window, fetch, addEventListener, matchMedia, IntersectionObserver, setTimeout, clearTimeout, setInterval, clearInterval } = scope;
(() => {
 const $=selector=>document.querySelector(selector);
 const customForm=$('#assessment-custom-form'),list=$('[data-custom-field-list]'),status=$('[data-custom-field-status]');
 const type=$('#assessment-field-type'),choices=$('#assessment-choice-options'),choiceLabel=$('[data-choice-options]');
 const build=$('[data-build-form]'),clear=$('[data-clear-custom]'),section=$('[data-built-assessment]'),report=$('#development-report-form');
 const fields=[],answers=new Map();let nextId=1,built=false,exporting=false;
 const observations=()=>$('#assessment-age').value==='younger'&&$('#assessment-approach').value==='observations';
 const eligible=field=>!(observations()&&field.type==='Score 1 to 10');
 const activeFields=()=>fields.filter(eligible);
 const context=()=>({age:$('#assessment-age').selectedOptions[0].textContent,level:$('#assessment-level').selectedOptions[0].textContent,approach:$('#assessment-age').value==='younger'?$('#assessment-approach').selectedOptions[0].textContent:'Coach assessment'});
 const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el};
 function showChoices(){choiceLabel.hidden=type.value!=='Choice list';choices.required=!choiceLabel.hidden}
 type.addEventListener('change',showChoices);showChoices();
 function button(label,visible,action,disabled=false){const el=node('button',visible,'field-action');el.type='button';el.setAttribute('aria-label',label);el.disabled=disabled;el.addEventListener('click',action);return el}
 function renderList(){
  list.replaceChildren();
  fields.forEach((field,index)=>{
   const row=node('li'),description=node('div',undefined,'field-description');
   description.append(node('strong',field.name),node('span',field.type+(field.required?' · Required':'')+(!eligible(field)?' · Not included in observations':'')));
   const actions=node('div',undefined,'field-actions');
   actions.append(button('Move '+field.name+' up','↑',()=>{[fields[index-1],fields[index]]=[fields[index],fields[index-1]];refresh()},index===0),button('Move '+field.name+' down','↓',()=>{[fields[index+1],fields[index]]=[fields[index],fields[index+1]];refresh()},index===fields.length-1),button('Remove '+field.name,'Remove',()=>{fields.splice(index,1);answers.delete(field.id);refresh();status.textContent=field.name+' removed.';$('#assessment-field-name').focus()}));
   row.append(description,actions);list.append(row);
  });
  clear.hidden=!fields.length;build.disabled=!activeFields().length;build.textContent=built?'Update form':'Build form';
 }
 function renderReport(){
  const current=activeFields(),ctx=context();
  $('[data-form-context]').textContent=[ctx.age,ctx.level,ctx.approach].join(' · ');
  $('[data-form-guidance]').textContent=observations()?'Focus on enjoyment, effort and a small next step. Score fields are left out of this observation form.':'Complete the fields below. Use the age group and player level to give your assessment context.';
  const container=$('[data-report-fields]');container.replaceChildren();
  current.forEach((field,index)=>{
   const wrapper=node('div',undefined,'report-field'),label=node('label');label.htmlFor='answer-'+field.id;label.append(node('span',String(index+1).padStart(2,'0'),'report-field-number'),document.createTextNode(field.name+(field.required?' (required)':'')));
   let input;
   if(field.type==='Choice list'||field.type==='Score 1 to 10'){
    input=node('select');input.append(new Option('Choose an answer',''));
    const options=field.type==='Score 1 to 10'?Array.from({length:10},(_,i)=>({value:String(i+1),label:(i+1)+' / 10 · '+scoreGuide[i][0]})):field.options.map(value=>({value,label:value}));
    options.forEach(option=>input.append(new Option(option.label,option.value)));
   }else if(field.type==='Longer notes'){input=node('textarea');input.rows=4;input.maxLength=4000}
   else{input=node('input');input.type=field.type==='Number'?'number':'text';if(input.type==='number')input.step='any';else input.maxLength=180}
   input.id='answer-'+field.id;input.name='answer-'+field.id;input.required=field.required;input.value=answers.get(field.id)||'';
   input.addEventListener('input',()=>{input.setCustomValidity('');answers.set(field.id,input.value);$('[data-export-status]').textContent=''});
   wrapper.append(label,input);container.append(wrapper);
  });
  if(!current.length)container.append(node('p','Add a development field above to continue.'));
  $('[data-export-pdf]').disabled=!current.length||exporting;
 }
 function refresh(){renderList();if(built)renderReport();$('[data-export-status]').textContent=''}
 customForm.addEventListener('submit',event=>{
  event.preventDefault();const input=$('#assessment-field-name'),name=input.value.trim();
  if(!name){status.textContent='Enter a field name.';input.focus();return}
  if(fields.length>=20){status.textContent='You can add up to 20 fields. Remove a field to make room.';return}
  if(fields.some(field=>field.name.toLocaleLowerCase()===name.toLocaleLowerCase())){status.textContent='That field already exists. Give this one a different name.';input.focus();return}
  const options=[...new Set(choices.value.split('\n').map(value=>value.trim()).filter(Boolean))];
  if(type.value==='Choice list'&&(options.length<2||options.length>10||options.some(value=>value.length>60))){status.textContent='Add 2 to 10 different choices, up to 60 characters each.';choices.focus();return}
  if(type.value==='Score 1 to 10'&&observations()){status.textContent='Use written observations for this assessment approach.';return}
  fields.push({id:nextId++,name,type:type.value,required:$('#assessment-field-required').checked,options});refresh();
  status.textContent=name+' added. '+fields.length+' of 20 fields.';input.value='';choices.value='';input.focus();
 });
 clear.addEventListener('click',()=>{if(!window.confirm('Clear all development fields and their answers? Player details will stay.'))return;fields.length=0;answers.clear();refresh();status.textContent='Fields cleared.';$('#assessment-field-name').focus()});
 build.addEventListener('click',()=>{built=true;section.hidden=false;renderReport();renderList();$('#built-assessment-heading').focus();section.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'})});
 $('[data-edit-fields]').addEventListener('click',()=>$('#assessment-field-name').focus());
 document.addEventListener('assessment-context-change',()=>{showChoices();refresh();if(fields.some(field=>!eligible(field)))status.textContent='Score fields are kept, but left out of the younger-player observation form.'});
 const today=new Date();$('#report-date').value=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
 report.addEventListener('submit',async event=>{
  event.preventDefault();if(exporting||!activeFields().length)return;
  activeFields().forEach(field=>{const input=$('#answer-'+field.id);input.setCustomValidity(field.required&&!input.value.trim()?'Complete this required field.':'')});
  const player=$('#report-player');player.setCustomValidity(player.value.trim()?'':'Enter the player name.');if(!report.reportValidity())return;
  const data={player:player.value.trim(),date:$('#report-date').value,team:$('#report-team').value.trim(),coach:$('#report-coach').value.trim(),...context(),fields:activeFields().map(field=>({...field,value:answers.get(field.id)||''}))};
  if(!data.fields.some(field=>field.value.trim())){$('[data-export-status]').textContent='Complete at least one development field before downloading.';return}
  exporting=true;$('[data-export-pdf]').disabled=true;$('[data-export-pdf]').textContent='Preparing your PDF…';$('[data-export-status]').textContent='';
  try{const {downloadDevelopmentPdf}=await import(/* @vite-ignore */ developmentPdfUrl);await downloadDevelopmentPdf(data);$('[data-export-status]').textContent='Your PDF is ready. Check your downloads.'}
  catch(error){console.error('Development PDF export failed',error);$('[data-export-status]').textContent='The PDF could not be created. Your answers are still here. Please try again.'}
  finally{exporting=false;$('[data-export-pdf]').disabled=!activeFields().length;$('[data-export-pdf]').textContent='Download branded PDF'}
 });
 $('#report-player').addEventListener('input',event=>event.target.setCustomValidity(''));
 refresh();
})();

}
